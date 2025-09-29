const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('利用可能なコマンドの一覧を表示します。'),
    async execute(interaction) {
        const isAdmin = interaction.member.permissions.has('Administrator');

        const userCommands = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📚 利用可能なコマンド一覧')
            .setDescription('以下が利用可能なコマンドです。')
            .addFields(
                { name: '👤 プロフィール関連', value: 
                    '`/profile` - プロフィールカードを表示\n' +
                    '`/settempdesc` - 仮説明文を設定\n' +
                    '`/setprofilebg` - プロフィールカードの背景を設定'
                },
                { name: '🏆 ランキング関連', value: 
                    '`/rank` - ランクカードを表示\n' +
                    '`/top` - ランキングを表示\n' +
                    '`/setrankbg` - ランクカードの背景を設定'
                },
                { name: '🔒 匿名投稿関連', value: 
                    '`/anonymous` - 匿名でメッセージを投稿\n' +
                    '`/kotehan` - コテハン（固定ハンドルネーム）を設定\n' +
                    '`/koteicon` - 固定アイコンを設定'
                },
                { name: '🎮 その他の機能', value: 
                    '`/club` - 部活情報を表示\n' +
                    '`/wordcloud` - ワードクラウドを生成'
                }
            )
            .setFooter({ text: 'コマンドの詳細は各コマンドの説明を参照してください。' });

        if (isAdmin) {
            const adminCommands = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('🔧 管理者専用コマンド')
                .addFields(
                    { name: '⚙️ 管理コマンド', value: 
                        '`/xp` - ユーザーのXPを操作\n' +
                        '`/transferxp` - XPを移行\n' +
                        '`/clearxpdata` - XPデータをクリア\n' +
                        '`/syncleader` - 部長情報を同期\n' +
                        '`/status` - ボットの状態を表示\n' +
                        '`/sort` - 部活チャンネルを並び替え'
                    },
                    { name: '🔒 匿名・アイコン管理', value: 
                        '`/anonlookup` - 匿名IDから送信者を特定\n' +
                        '`/notionicon` - DiscordアイコンをNotionに同期'
                    },
                    { name: '🛠️ システムコマンド', value: 
                        '`/link` - アカウントを連携\n' +
                        '`/linkmain` - メインアカウントを連携\n' +
                        '`/listservers` - 参加サーバー一覧\n' +
                        '`/leftservers` - 退出サーバー一覧\n' +
                        '`/migrateprobot` - ProBotからの移行\n' +
                        '`/migrateleaders` - 部長ロール方式を移行'
                    }
                )
                .setFooter({ text: 'これらのコマンドは管理者のみが使用できます。' });

            await interaction.reply({ embeds: [userCommands, adminCommands], flags: [MessageFlags.Ephemeral] });
        } else {
            await interaction.reply({ embeds: [userCommands], flags: [MessageFlags.Ephemeral] });
        }
    },
}; 