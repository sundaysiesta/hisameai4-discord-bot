const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getEventStatus, startEvent, stopEvent, sendEventNotification } = require('../utils/anonymousEvent.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('anonymousevent')
        .setDescription('匿名イベントの開始/停止を管理します（100回に1回で匿名が剥がれます）')
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('匿名イベントを開始します')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stop')
                .setDescription('匿名イベントを停止します')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('現在のイベント状態を確認します')
        ),
    
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        
        // 管理者権限チェック（必要に応じて調整）
        if (!interaction.member.permissions.has('Administrator')) {
            return interaction.reply({ 
                content: 'このコマンドは管理者のみ使用できます。', 
                ephemeral: true 
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            switch (subcommand) {
                case 'start':
                    const started = startEvent();
                    if (started) {
                        await sendEventNotification(interaction.client, 'start', interaction.user.id);
                        
                        const embed = new EmbedBuilder()
                            .setTitle('🎭 匿名イベント開始')
                            .setDescription('匿名イベントが開始されました！\n100回に1回の確率で匿名が剥がれます。')
                            .setColor(0x00ff00)
                            .addFields(
                                { name: '状態', value: 'アクティブ', inline: true },
                                { name: '確率', value: '100回に1回', inline: true },
                                { name: 'カウンター', value: '0', inline: true }
                            )
                            .setTimestamp();
                        
                        await interaction.editReply({ embeds: [embed] });
                    } else {
                        await interaction.editReply({ 
                            content: 'イベントの開始に失敗しました。' 
                        });
                    }
                    break;

                case 'stop':
                    const stopped = stopEvent();
                    if (stopped) {
                        await sendEventNotification(interaction.client, 'stop', interaction.user.id);
                        
                        const embed = new EmbedBuilder()
                            .setTitle('🔒 匿名イベント停止')
                            .setDescription('匿名イベントが停止されました。')
                            .setColor(0xff0000)
                            .addFields(
                                { name: '状態', value: '非アクティブ', inline: true },
                                { name: 'カウンター', value: 'リセット済み', inline: true }
                            )
                            .setTimestamp();
                        
                        await interaction.editReply({ embeds: [embed] });
                    } else {
                        await interaction.editReply({ 
                            content: 'イベントの停止に失敗しました。' 
                        });
                    }
                    break;

                case 'status':
                    const status = getEventStatus();
                    const embed = new EmbedBuilder()
                        .setTitle('📊 匿名イベント状態')
                        .setColor(status.isActive ? 0x00ff00 : 0x808080)
                        .addFields(
                            { name: '状態', value: status.isActive ? 'アクティブ' : '非アクティブ', inline: true },
                            { name: '現在のカウンター', value: status.counter.toString(), inline: true },
                            { name: '閾値', value: status.threshold.toString(), inline: true },
                            { name: '残り投稿数', value: status.isActive ? (status.threshold - status.counter).toString() : 'N/A', inline: true }
                        )
                        .setTimestamp();
                    
                    await interaction.editReply({ embeds: [embed] });
                    break;

                default:
                    await interaction.editReply({ 
                        content: '不明なサブコマンドです。' 
                    });
            }
        } catch (error) {
            console.error('匿名イベントコマンドエラー:', error);
            await interaction.editReply({ 
                content: 'コマンドの実行中にエラーが発生しました。' 
            });
        }
    }
};
