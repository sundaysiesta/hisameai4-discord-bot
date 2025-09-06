const { Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, WebhookClient, PermissionsBitField, ChannelType, ButtonBuilder, ButtonStyle, MessageFlags, EmbedBuilder } = require('discord.js');
const config = require('../config.js');
const { postStickyMessage } = require('../utils/utility.js'); // postStickyMessageをインポート

// 部活作成用のクールダウン管理はRedisに移行（メモリ節約）

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
                if (interaction.customId === config.CREATE_CLUB_BUTTON_ID) {
                    // 部活作成のクールダウンチェック（Redis使用）
                    const cooldownKey = `club_creation_cooldown:${interaction.user.id}`;
                    const cooldownEnd = await redis.get(cooldownKey);
                    if (cooldownEnd) {
                        const now = Date.now();
                        const remaining = parseInt(cooldownEnd) - now;
                        if (remaining > 0) {
                            const remainingDays = Math.ceil(remaining / (1000 * 60 * 60 * 24));
                            const remainingHours = Math.ceil((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                            let remainingText = '';
                            if (remainingDays > 0) {
                                remainingText = `あと ${remainingDays} 日`;
                                if (remainingHours > 0) {
                                    remainingText += ` ${remainingHours} 時間`;
                                }
                            } else {
                                remainingText = `あと ${remainingHours} 時間`;
                            }
                            remainingText += 'お待ちください。';
                            return interaction.reply({ content: `部活作成は7日に1回までです。${remainingText}`, flags: [MessageFlags.Ephemeral] });
                        }
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
                if (interaction.customId === config.CREATE_CLUB_MODAL_ID) {
                    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                    const clubName = interaction.fields.getTextInputValue('club_name').trim();
                    const clubActivity = interaction.fields.getTextInputValue('club_activity').trim();
                    const creator = interaction.member;
                    
                    // 入力検証
                    if (clubName.length < 2 || clubName.length > 20) {
                        return interaction.editReply({ content: '部活名は2文字以上20文字以下で入力してください。' });
                    }
                    if (clubActivity.length < 10 || clubActivity.length > 200) {
                        return interaction.editReply({ content: '活動内容は10文字以上200文字以下で入力してください。' });
                    }
                    
                    // 部活名の重複チェック
                    const existingChannels = [];
                    for (const categoryId of config.CLUB_CATEGORIES) {
                        const category = await interaction.guild.channels.fetch(categoryId).catch(() => null);
                        if (category && category.children) {
                            const channels = category.children.cache.filter(ch => 
                                ch.type === ChannelType.GuildText && 
                                ch.name.toLowerCase() === clubName.toLowerCase()
                            );
                            existingChannels.push(...channels.values());
                        }
                    }
                    
                    if (existingChannels.length > 0) {
                        return interaction.editReply({ content: `部活名「${clubName}」は既に存在します。別の名前を選択してください。` });
                    }
                    
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
                        
                        const newChannel = await interaction.guild.channels.create({
                            name: clubName,
                            type: ChannelType.GuildText,
                            parent: targetCategoryId,
                            topic: `部長: <@${creator.id}>\n活動内容: ${clubActivity}`,
                            permissionOverwrites: [
                                { id: creator.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ManageMessages] },
                                { id: interaction.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                            ],
                        });
                        // 新方式: チャンネルごとの部長（ユーザーID）を保存
                        await redis.set(`leader_user:${newChannel.id}`, creator.id);
                        // Notionの『部長』プロパティにチャンネルIDを追記
                        try {
                            const notionRes = await notion.databases.query({
                                database_id: config.NOTION_DATABASE_ID,
                                filter: { property: 'DiscordユーザーID', rich_text: { equals: creator.id } }
                            });
                            if (notionRes.results.length > 0) {
                                const pageId = notionRes.results[0].id;
                                const current = notionRes.results[0].properties?.['部長'];
                                const prev = (current && current.rich_text && current.rich_text[0]?.plain_text) ? current.rich_text[0].plain_text : '';
                                const ids = new Set((prev || '').split(',').map(s => s.trim()).filter(Boolean));
                                ids.add(newChannel.id);
                                await notion.pages.update({
                                    page_id: pageId,
                                    properties: { '部長': { rich_text: [{ text: { content: Array.from(ids).join(',') } }] } }
                                });
                            }
                        } catch (e) { console.error('Notion 部長更新エラー:', e); }
                        if (config.ROLE_TO_REMOVE_ON_CREATE) {
                            const roleToRemove = await interaction.guild.roles.fetch(config.ROLE_TO_REMOVE_ON_CREATE).catch(()=>null);
                            if(roleToRemove) await creator.roles.remove(roleToRemove);
                        }
                        
                        const categoryName = targetCategoryId === config.CLUB_CATEGORY_ID ? 'カテゴリー1' : 'カテゴリー2';
                        await interaction.editReply({ content: `部活「${clubName}」を${categoryName}に設立しました！ ${newChannel} を確認してください。` });
                        // 部活作成完了後にクールダウンを設定（Redis使用）
                        const cooldownEnd = Date.now() + config.CLUB_CREATION_COOLDOWN;
                        await redis.setex(cooldownKey, Math.ceil(config.CLUB_CREATION_COOLDOWN / 1000), cooldownEnd.toString());

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
