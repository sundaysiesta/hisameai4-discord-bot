const { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, WebhookClient, PermissionsBitField, ChannelType, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../config.js');
const { postStickyMessage } = require('../utils/utility.js'); // postStickyMessageをインポート

const cooldowns = new Map();
const webhookClient = new WebhookClient({ url: config.ANONYMOUS_WEBHOOK_URL });

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction, redis, notion) {
        if (!interaction.inGuild()) return;

        try {
            // スラッシュコマンドの処理
            if (interaction.isChatInputCommand()) {
                const command = interaction.client.commands.get(interaction.commandName);
                if (!command) return console.error(`No command matching ${interaction.commandName} was found.`);
                await command.execute(interaction, redis, notion);
            }
            // ボタンの処理
            else if (interaction.isButton()) {
                if (interaction.customId === config.STICKY_BUTTON_ID) {
                    const now = Date.now();
                    const userCooldown = cooldowns.get(interaction.user.id);
                    if (userCooldown && now < userCooldown) {
                        const remaining = Math.ceil((userCooldown - now) / 1000);
                        return interaction.reply({ content: `クールダウン中です。あと ${remaining} 秒お待ちください。`, flags: [MessageFlags.Ephemeral] });
                    }
                    const modal = new ModalBuilder().setCustomId(config.ANONYMOUS_MODAL_ID).setTitle('匿名メッセージ投稿');
                    const messageInput = new TextInputBuilder().setCustomId('messageInput').setLabel('メッセージ内容 (改行不可・140字以内)').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(140);
                    modal.addComponents(new ActionRowBuilder().addComponents(messageInput));
                    await interaction.showModal(modal);
                }
                if (interaction.customId === config.CREATE_CLUB_BUTTON_ID) {
                    const modal = new ModalBuilder().setCustomId(config.CREATE_CLUB_MODAL_ID).setTitle('部活作成フォーム');
                    const nameInput = new TextInputBuilder().setCustomId('club_name').setLabel('部活名').setStyle(TextInputStyle.Short).setRequired(true);
                    const activityInput = new TextInputBuilder().setCustomId('club_activity').setLabel('活動内容').setStyle(TextInputStyle.Paragraph).setRequired(true);
                    modal.addComponents(new ActionRowBuilder().addComponents(nameInput), new ActionRowBuilder().addComponents(activityInput));
                    await interaction.showModal(modal);
                }
                // 代理投稿削除ボタン
                if (interaction.customId && interaction.customId.startsWith('delete_proxy_')) {
                    const proxyDeleteMap = global.proxyDeleteMap || {};
                    const targetMsg = await interaction.channel.messages.fetch(interaction.message.id).catch(() => null);
                    const ownerId = proxyDeleteMap[interaction.message.id];
                    if (interaction.user.id === ownerId) {
                        if (targetMsg) await targetMsg.delete().catch(() => {});
                        await interaction.reply({ content: 'メッセージを削除しました。', ephemeral: true });
                        delete proxyDeleteMap[interaction.message.id];
                    } else {
                        await interaction.reply({ content: 'このメッセージを削除できるのは投稿者のみです。', ephemeral: true });
                    }
                    return;
                }
            }
            // フォーム送信の処理
            else if (interaction.isModalSubmit()) {
                if (interaction.customId === config.ANONYMOUS_MODAL_ID) {
                    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                    const messageContent = interaction.fields.getTextInputValue('messageInput');
                    if (messageContent.includes('\n')) {
                        return interaction.editReply({ content: 'エラー: メッセージに改行を含めることはできません。' });
                    }
                    try {
                        const newCounter = await redis.incr('anonymous_message_counter');
                        await webhookClient.send({ content: messageContent, username: newCounter.toString(), allowedMentions: { parse: [] } });
                        
                        // 【最重要修正】ここでSticky Messageを直接更新
                        const payload = { components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.STICKY_BUTTON_ID).setLabel('書き込む').setStyle(ButtonStyle.Success).setEmoji('✍️'))] };
                        await postStickyMessage(interaction.client, interaction.channel, config.STICKY_BUTTON_ID, payload);
                        
                        await interaction.editReply({ content: 'メッセージを匿名で投稿しました。' });
                        cooldowns.set(interaction.user.id, Date.now() + 60 * 1000);
                    } catch (error) {
                        console.error("Anonymous post error:", error);
                        await interaction.editReply({ content: 'エラーが発生し、メッセージを投稿できませんでした。' });
                    }
                }
                if (interaction.customId === config.CREATE_CLUB_MODAL_ID) {
                    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                    const clubName = interaction.fields.getTextInputValue('club_name');
                    const clubActivity = interaction.fields.getTextInputValue('club_activity');
                    const creator = interaction.member;
                    try {
                        const leaderRole = await interaction.guild.roles.create({ name: `${clubName}部長` });
                        const newChannel = await interaction.guild.channels.create({
                            name: clubName,
                            type: ChannelType.GuildText,
                            parent: config.CLUB_CATEGORY_ID,
                            topic: `部長: <@${creator.id}>\n活動内容: ${clubActivity}`,
                            permissionOverwrites: [
                                { id: leaderRole.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageMessages] },
                                { id: interaction.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                            ],
                        });
                        await redis.set(`leader_roles:${newChannel.id}`, leaderRole.id);
                        await creator.roles.add(leaderRole);
                        if (config.ROLE_TO_REMOVE_ON_CREATE) {
                            const roleToRemove = await interaction.guild.roles.fetch(config.ROLE_TO_REMOVE_ON_CREATE).catch(()=>null);
                            if(roleToRemove) await creator.roles.remove(roleToRemove);
                        }
                        
                        await interaction.editReply({ content: `部活「${clubName}」を設立しました！ ${newChannel} を確認してください。` });

                    } catch (error) {
                        console.error('部活作成プロセス中にエラー:', error);
                        await interaction.editReply({ content: 'エラーが発生し、部活を作成できませんでした。' });
                    }
                }
            }
        } catch (error) {
            console.error('インタラクション処理中に予期せぬエラーが発生しました:', error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'コマンドの実行中にエラーが発生しました。', flags: [MessageFlags.Ephemeral] });
            } else {
                await interaction.reply({ content: 'コマンドの実行中にエラーが発生しました。', flags: [MessageFlags.Ephemeral] });
            }
        }
	},
};
