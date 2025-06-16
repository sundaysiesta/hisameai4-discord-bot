const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { Redis } = require('@upstash/redis');
const { Client: NotionClient } = require('@notionhq/client');
require('dotenv').config();

// 未処理のエラーをキャッチ
process.on('uncaughtException', (error) => {
    console.error('未処理の例外が発生しました:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('未処理のPromise拒否が発生しました:', error);
});

// プロセス終了時の処理
process.on('exit', (code) => {
    console.log(`プロセスが終了コード ${code} で終了しました`);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ],
});

// Redis接続のエラーハンドリング
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

redis.on('error', (error) => {
    console.error('Redis接続エラー:', error);
});

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
        } else {
            client.on(event.name, (...args) => event.execute(...args, redis, notion));
        }
    } catch (error) {
        console.error(`イベント ${file} の読み込み中にエラーが発生しました:`, error);
    }
}

// BotをDiscordにログイン
client.login(process.env.DISCORD_BOT_TOKEN).catch(error => {
    console.error('Discordへのログイン中にエラーが発生しました:', error);
    process.exit(1);
});
