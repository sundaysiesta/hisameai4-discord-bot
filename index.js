const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { Redis } = require('@upstash/redis');
const { Client: NotionClient } = require('@notionhq/client');
require('dotenv').config();

// 未処理のエラーをキャッチ
process.on('uncaughtException', (error) => {
    console.error('未処理の例外が発生しました:', error);
    // エラーをログに記録した後、プロセスを終了しない
});

process.on('unhandledRejection', (error) => {
    console.error('未処理のPromise拒否が発生しました:', error);
    // エラーをログに記録した後、プロセスを終了しない
});

// プロセス終了時の処理
process.on('SIGTERM', () => {
    console.log('SIGTERMシグナルを受信しました。クリーンアップを実行します...');
    // クリーンアップ処理をここに追加
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINTシグナルを受信しました。クリーンアップを実行します...');
    // クリーンアップ処理をここに追加
    process.exit(0);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,  // ボイスチャットの状態を監視
        GatewayIntentBits.GuildPresences,    // プレゼンスの更新を監視
    ],
    presence: {
        status: 'online',
        activities: [{
            name: '起動中...',
            type: 0
        }]
    }
});

// Redis接続のエラーハンドリング
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

redis.on('error', (error) => {
    console.error('Redis接続エラー:', error);
    // エラーをログに記録した後、再接続を試みる
    setTimeout(() => {
        console.log('Redisへの再接続を試みます...');
        redis.connect().catch(err => {
            console.error('Redisへの再接続に失敗しました:', err);
        });
    }, 5000);
});

// Redisクライアントをグローバルに設定
client.redis = redis;

const notion = new NotionClient({ auth: process.env.NOTION_API_KEY });

// --- コマンドハンドリング ---
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    try {
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
            console.log(`コマンド ${command.data.name} を読み込みました。`);
        } else {
            console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
        }
    } catch (error) {
        console.error(`コマンド ${file} の読み込み中にエラーが発生しました:`, error);
    }
}

// --- イベントハンドリング ---
const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    try {
        const event = require(filePath);
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, redis, notion));
            console.log(`イベント ${event.name} (once) を登録しました。`);
        } else {
            client.on(event.name, (...args) => event.execute(...args, redis, notion));
            console.log(`イベント ${event.name} を登録しました。`);
        }
    } catch (error) {
        console.error(`イベント ${file} の読み込み中にエラーが発生しました:`, error);
    }
}

// BotをDiscordにログイン
console.log('Discordにログインを試みています...');
client.login(process.env.DISCORD_BOT_TOKEN).catch(error => {
    console.error('Discordへのログイン中にエラーが発生しました:', error);
    // エラーをログに記録した後、5秒待って再試行
    setTimeout(() => {
        console.log('Discordへの再接続を試みます...');
        client.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
            console.error('Discordへの再接続に失敗しました:', err);
        });
    }, 5000);
});
