const { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, WebhookClient, PermissionsBitField, ChannelType, ButtonBuilder, ButtonStyle, MessageFlags, EmbedBuilder } = require('discord.js');
const config = require('../config.js');
const { postStickyMessage } = require('../utils/utility.js'); // postStickyMessageをインポート

const cooldowns = new Map();
const clubCreationCooldowns = new Map(); // 部活作成用のクールダウン管理
let webhookClient = null; // 遅延初期化に変更

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
                    // 部活作成のクールダウンチェック
                    const now = Date.now();
                    const userClubCooldown = clubCreationCooldowns.get(interaction.user.id);
                    if (userClubCooldown && now < userClubCooldown) {
                        const remainingHours = Math.ceil((userClubCooldown - now) / (1000 * 60 * 60));
                        const remainingMinutes = Math.ceil(((userClubCooldown - now) % (1000 * 60 * 60)) / (1000 * 60));
                        let remainingText = '';
                        if (remainingHours > 0) {
                            remainingText = `あと ${remainingHours} 時間`;
                            if (remainingMinutes > 0) {
                                remainingText += ` ${remainingMinutes} 分`;
                            }
                        } else {
                            remainingText = `あと ${remainingMinutes} 分`;
                        }
                        remainingText += 'お待ちください。';
                        return interaction.reply({ content: `部活作成は24時間に1回までです。${remainingText}`, flags: [MessageFlags.Ephemeral] });
                    }
                    
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
                    if (!config.ANONYMOUS_WEBHOOK_URL) {
                        return interaction.editReply({ content: '匿名投稿は現在利用できません（設定未完了）。管理者に連絡してください。' });
                    }
                    if (!webhookClient) {
                        webhookClient = new WebhookClient({ url: config.ANONYMOUS_WEBHOOK_URL });
                    }
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
                        // カテゴリー1のチャンネル数をチェック
                        const category1 = await interaction.guild.channels.fetch(config.CLUB_CATEGORY_ID).catch(() => null);
                        let targetCategoryId = config.CLUB_CATEGORY_ID;
                        
                        if (category1 && category1.children.cache.size >= 50) {
                            // カテゴリー1が50チャンネルに達している場合、カテゴリー2を使用
                            const category2 = await interaction.guild.channels.fetch(config.CLUB_CATEGORY_ID_2).catch(() => null);
                            if (category2) {
                                targetCategoryId = config.CLUB_CATEGORY_ID_2;
                                console.log(`カテゴリー1が満杯のため、カテゴリー2に部活「${clubName}」を作成します。`);
                            } else {
                                throw new Error('カテゴリー2が見つかりません。');
                            }
                        }
                        
                        const leaderRole = await interaction.guild.roles.create({ name: `${clubName}部長` });
                        const newChannel = await interaction.guild.channels.create({
                            name: clubName,
                            type: ChannelType.GuildText,
                            parent: targetCategoryId,
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
                        
                        const categoryName = targetCategoryId === config.CLUB_CATEGORY_ID ? 'カテゴリー1' : 'カテゴリー2';
                        await interaction.editReply({ content: `部活「${clubName}」を${categoryName}に設立しました！ ${newChannel} を確認してください。` });
                        clubCreationCooldowns.set(interaction.user.id, Date.now() + 24 * 60 * 60 * 1000); // 部活作成完了後にクールダウンを設定

                        // 部活作成完了の埋め込みメッセージを作成
                        const clubEmbed = new EmbedBuilder()
                            .setColor(0x00ff00)
                            .setTitle('🎉 新しい部活が設立されました！')
                            .addFields(
                                { name: '部活名', value: clubName, inline: true },
                                { name: '部長', value: `<@${creator.id}>`, inline: true },
                                { name: '活動内容', value: clubActivity, inline: false },
                                { name: 'チャンネル', value: `${newChannel}`, inline: false }
                            )
                            .setTimestamp()
                            .setFooter({ text: 'HisameAI Mark.4' });

                        // 部活チャンネルに埋め込みメッセージを送信
                        try {
                            await newChannel.send({ embeds: [clubEmbed] });
                        } catch (error) {
                            console.error('部活チャンネルへの埋め込みメッセージ送信エラー:', error);
                        }

                        // メインチャンネルに埋め込みメッセージを送信
                        try {
                            const mainChannel = await interaction.guild.channels.fetch(config.MAIN_CHANNEL_ID);
                            if (mainChannel) {
                                await mainChannel.send({ embeds: [clubEmbed] });
                            }
                        } catch (error) {
                            console.error('メインチャンネルへの埋め込みメッセージ送信エラー:', error);
                        }

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
