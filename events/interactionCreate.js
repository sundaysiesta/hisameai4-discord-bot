const { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, WebhookClient, PermissionsBitField, ChannelType, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('../config.js');
const { postStickyMessage } = require('../utils/utility.js');

const cooldowns = new Map();
const webhookClient = new WebhookClient({ url: config.ANONYMOUS_WEBHOOK_URL });

module.exports = {
	name: Events.InteractionCreate,
	async execute(interaction, redis, notion) {
        if (!interaction.inGuild()) return;

        try {
            if (interaction.isChatInputCommand()) {
                const command = interaction.client.commands.get(interaction.commandName);
                if (!command) return console.error(`No command matching ${interaction.commandName} was found.`);
                await command.execute(interaction, redis, notion);
            }
            else if (interaction.isButton()) {
                if (interaction.customId === config.STICKY_BUTTON_ID) {
                    const now = Date.now();
                    const userCooldown = cooldowns.get(interaction.user.id);
                    if (userCooldown && now < userCooldown) {
                        const remaining = Math.ceil((userCooldown - now) / 1000);
                        return interaction.reply({ content: `クールダウン中です。あと ${remaining} 秒お待ちください。`, ephemeral: true });
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
            }
            else if (interaction.isModalSubmit()) {
                if (interaction.customId === config.ANONYMOUS_MODAL_ID) {
                    await interaction.deferReply({ ephemeral: true });
                    const messageContent = interaction.fields.getTextInputValue('messageInput');
                    if (messageContent.includes('\n')) {
                        return interaction.editReply({ content: 'エラー: メッセージに改行を含めることはできません。' });
                    }
                    try {
                        const newCounter = await redis.incr('anonymous_message_counter');
                        await webhookClient.send({ content: messageContent, username: newCounter.toString(), allowedMentions: { parse: [] } });
                        
                        // 【最重要修正】ここでSticky Messageを更新
                        const payload = { components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.STICKY_BUTTON_ID).setLabel('書き込む').setStyle(ButtonStyle.Success).setEmoji('✍️'))] };
                        await postStickyMessage(interaction.client, interaction.channel, config.STICKY_BUTTON_ID, payload);

                        await interaction.editReply({ content: 'メッセージを匿名で投稿しました。' });
                        cooldowns.set(interaction.user.id, Date.now() + 60 * 1000);
                    } catch (error) {
                        await interaction.editReply({ content: 'エラーが発生し、メッセージを投稿できませんでした。' });
                    }
                }
                if (interaction.customId === config.CREATE_CLUB_MODAL_ID) {
                    await interaction.deferReply({ ephemeral: true });
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
                        
                        const panelChannel = await interaction.client.channels.fetch(config.CLUB_PANEL_CHANNEL_ID).catch(() => null);
                        if (panelChannel) {
                           const payload = { content: '新しい部活を設立するには、下のボタンを押してください。', components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(config.CREATE_CLUB_BUTTON_ID).setLabel('部活を作成する').setStyle(ButtonStyle.Primary).setEmoji('🎫'))] };
                           await postStickyMessage(interaction.client, panelChannel, config.CREATE_CLUB_BUTTON_ID, payload);
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
                await interaction.followUp({ content: 'コマンドの実行中にエラーが発生しました。', ephemeral: true }).catch(() => {});
            } else {
                await interaction.reply({ content: 'コマンドの実行中にエラーが発生しました。', ephemeral: true }).catch(() => {});
            }
        }
	},
};
