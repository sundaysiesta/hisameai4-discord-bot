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
                
                try {
                    await command.execute(interaction, redis, notion);
                } catch (commandError) {
                    console.error(`コマンド ${interaction.commandName} の実行中にエラー:`, commandError);
                    
                    // Discord API エラーコード10062（Unknown interaction）の特別処理
                    if (commandError.code === 10062) {
                        console.log(`インタラクション ${interaction.id} は既に期限切れまたは処理済みです`);
                        return; // エラーレスポンスを送信しない
                    }
                    
                    // コマンド実行エラーの場合、適切に応答
                    if (!interaction.replied && !interaction.deferred) {
                        try {
                            await interaction.reply({ content: 'コマンドの実行中にエラーが発生しました。', flags: [MessageFlags.Ephemeral] });
                        } catch (replyError) {
                            console.error('コマンドエラー時のreply失敗:', replyError);
                        }
                    } else if (interaction.deferred && !interaction.replied) {
                        try {
                            await interaction.editReply({ content: 'コマンドの実行中にエラーが発生しました。' });
                        } catch (editError) {
                            console.error('コマンドエラー時のeditReply失敗:', editError);
                        }
                    }
                }
            }
            // ボタンの処理
            else if (interaction.isButton()) {
                if (interaction.customId === config.CREATE_CLUB_BUTTON_ID) {
                    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                    
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
                            return interaction.editReply({ content: `部活作成は7日に1回までです。${remainingText}` });
                        }
                    }
                    
                    // ロメコイン残高を確認
                    try {
                        const balanceResponse = await fetch(`${config.CROSSROID_API_URL}/api/romecoin/${interaction.user.id}`, {
                            headers: {
                                'x-api-token': config.CROSSROID_API_TOKEN
                            }
                        });
                        
                        if (!balanceResponse.ok) {
                            console.error(`ロメコイン残高取得エラー: ${balanceResponse.status} ${balanceResponse.statusText}`);
                            return interaction.editReply({ content: 'ロメコイン残高の確認中にエラーが発生しました。しばらくしてから再度お試しください。' });
                        }
                        
                        const balanceData = await balanceResponse.json();
                        const currentBalance = balanceData.balance || 0;
                        
                        if (currentBalance < config.ROMECOIN_REQUIRED_FOR_CLUB_CREATION) {
                            return interaction.editReply({ 
                                content: `部活作成には<:romecoin2:1452874868415791236> ${config.ROMECOIN_REQUIRED_FOR_CLUB_CREATION.toLocaleString()}が必要です。現在の残高: <:romecoin2:1452874868415791236> ${currentBalance.toLocaleString()}` 
                            });
                        }
                    } catch (error) {
                        console.error('ロメコイン残高確認エラー:', error);
                        return interaction.editReply({ content: 'ロメコイン残高の確認中にエラーが発生しました。しばらくしてから再度お試しください。' });
                    }
                    
                    // 残高が十分な場合のみモーダルを表示
                    await interaction.deleteReply();
                    const modal = new ModalBuilder().setCustomId(config.CREATE_CLUB_MODAL_ID).setTitle('部活作成フォーム');
                    const nameInput = new TextInputBuilder().setCustomId('club_name').setLabel('部活名').setStyle(TextInputStyle.Short).setRequired(true);
                    const emojiInput = new TextInputBuilder().setCustomId('club_emoji').setLabel('絵文字').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('例: ⚽ 🎵 🎨 🎮').setMaxLength(10);
                    const activityInput = new TextInputBuilder().setCustomId('club_activity').setLabel('活動内容').setStyle(TextInputStyle.Paragraph).setRequired(true);
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(nameInput), 
                        new ActionRowBuilder().addComponents(emojiInput),
                        new ActionRowBuilder().addComponents(activityInput)
                    );
                    await interaction.showModal(modal);
                }
                // 代理投稿削除ボタン
                if (interaction.customId && interaction.customId.startsWith('delete_proxy_')) {
                    const proxyDeleteMap = global.proxyDeleteMap || {};
                    const targetMsg = await interaction.channel.messages.fetch(interaction.message.id).catch(() => null);
                    const ownerId = proxyDeleteMap[interaction.message.id];
                    if (interaction.user.id === ownerId) {
                        // 削除前に画像をログチャンネルに送信
                        if (targetMsg && targetMsg.attachments.size > 0) {
                            try {
                                const logChannel = interaction.client.channels.cache.get('1431905160875212864');
                                if (logChannel) {
                                    const logEmbed = new EmbedBuilder()
                                        .setTitle('🗑️ 代行投稿削除ログ')
                                        .setDescription(`**削除者:** ${interaction.user.username} (${interaction.user.id})\n**元の投稿者:** <@${ownerId}>\n**削除時刻:** <t:${Math.floor(Date.now() / 1000)}:F>`)
                                        .setColor(0xff0000)
                                        .setTimestamp();
                                    
                                    const logFiles = targetMsg.attachments.map(attachment => ({
                                        attachment: attachment.url,
                                        name: attachment.name
                                    }));
                                    
                                    await logChannel.send({
                                        embeds: [logEmbed],
                                        files: logFiles
                                    });
                                }
                            } catch (logError) {
                                console.error('ログ送信エラー:', logError);
                            }
                        }
                        
                        if (targetMsg) await targetMsg.delete().catch(() => {});
                        await interaction.reply({ content: 'メッセージを削除しました。', flags: [MessageFlags.Ephemeral] });
                        delete proxyDeleteMap[interaction.message.id];
                    } else {
                        await interaction.reply({ content: 'このメッセージを削除できるのは投稿者のみです。', flags: [MessageFlags.Ephemeral] });
                    }
                    return;
                }
            }
            // フォーム送信の処理
            else if (interaction.isModalSubmit()) {
                if (interaction.customId === config.CREATE_CLUB_MODAL_ID) {
                    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
                    const clubName = interaction.fields.getTextInputValue('club_name').trim();
                    const clubEmoji = interaction.fields.getTextInputValue('club_emoji').trim();
                    const clubActivity = interaction.fields.getTextInputValue('club_activity').trim();
                    const creator = interaction.member;
                    
                    // クールダウンキーを先に定義
                    const cooldownKey = `club_creation_cooldown:${interaction.user.id}`;
                    
                    // 入力検証
                    if (clubName.length < 2 || clubName.length > 20) {
                        return interaction.editReply({ content: '部活名は2文字以上20文字以下で入力してください。' });
                    }
                    if (!clubEmoji || clubEmoji.length === 0) {
                        return interaction.editReply({ content: '絵文字を入力してください。' });
                    }
                    if (clubActivity.length < 10 || clubActivity.length > 200) {
                        return interaction.editReply({ content: '活動内容は10文字以上200文字以下で入力してください。' });
                    }
                    
                    // ロメコイン残高を確認
                    try {
                        const balanceResponse = await fetch(`${config.CROSSROID_API_URL}/api/romecoin/${interaction.user.id}`, {
                            headers: {
                                'x-api-token': config.CROSSROID_API_TOKEN
                            }
                        });
                        
                        if (!balanceResponse.ok) {
                            console.error(`ロメコイン残高取得エラー: ${balanceResponse.status} ${balanceResponse.statusText}`);
                            return interaction.editReply({ content: 'ロメコイン残高の確認中にエラーが発生しました。しばらくしてから再度お試しください。' });
                        }
                        
                        const balanceData = await balanceResponse.json();
                        const currentBalance = balanceData.balance || 0;
                        
                        if (currentBalance < config.ROMECOIN_REQUIRED_FOR_CLUB_CREATION) {
                            return interaction.editReply({ 
                                content: `部活作成には<:romecoin2:1452874868415791236> ${config.ROMECOIN_REQUIRED_FOR_CLUB_CREATION.toLocaleString()}が必要です。現在の残高: <:romecoin2:1452874868415791236> ${currentBalance.toLocaleString()}` 
                            });
                        }
                    } catch (error) {
                        console.error('ロメコイン残高確認エラー:', error);
                        return interaction.editReply({ content: 'ロメコイン残高の確認中にエラーが発生しました。しばらくしてから再度お試しください。' });
                    }
                    
                    // 絵文字の最初の文字のみを使用（複数絵文字が入力された場合の対応）
                    const firstEmoji = clubEmoji.trim().split(' ')[0] || '🎯';
                    
                    // 部活名を「絵文字｜部活名」の形式に変換
                    const channelName = `${firstEmoji}｜${clubName}`;
                    
                    // 部活名の重複チェック（絵文字付きチャンネル名でチェック）
                    const existingChannels = [];
                    for (const categoryId of config.CLUB_CATEGORIES) {
                        const category = await interaction.guild.channels.fetch(categoryId).catch(() => null);
                        if (category && category.children) {
                            const channels = category.children.cache.filter(ch => 
                                ch.type === ChannelType.GuildText && 
                                ch.name.toLowerCase() === channelName.toLowerCase()
                            );
                            existingChannels.push(...channels.values());
                        }
                    }
                    
                    if (existingChannels.length > 0) {
                        return interaction.editReply({ content: `部活名「${clubName}」は既に存在します。別の名前を選択してください。` });
                    }
                    
                    try {
                        // 新しく作成した部活は人気部活カテゴリに配置
                        let targetCategoryId = config.POPULAR_CLUB_CATEGORY_ID;
                        console.log(`新規部活「${clubName}」を人気部活カテゴリに作成します。`);
                        
                        const newChannel = await interaction.guild.channels.create({
                            name: channelName,
                            type: ChannelType.GuildText,
                            parent: targetCategoryId,
                            topic: `部長: <@${creator.id}>\n活動内容: ${clubActivity}`,
                            permissionOverwrites: [
                                { id: creator.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ManageMessages, PermissionsBitField.Flags.ManageRoles] },
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
                        
                        // ロメコインを減らす
                        let newBalance = 0;
                        try {
                            const deductResponse = await fetch(`${config.CROSSROID_API_URL}/api/romecoin/${interaction.user.id}/deduct`, {
                                method: 'POST',
                                headers: {
                                    'x-api-token': config.CROSSROID_API_TOKEN,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ amount: config.ROMECOIN_REQUIRED_FOR_CLUB_CREATION })
                            });
                            
                            const deductData = await deductResponse.json();
                            
                            if (!deductResponse.ok || deductData.error) {
                                // エラーレスポンスの場合
                                const errorMessage = deductData.error || `HTTP ${deductResponse.status}`;
                                console.error(`ロメコイン減算エラー: ${errorMessage}`);
                                // 部活は作成済みなので、エラーログを残すが処理は続行
                                console.error('部活作成は成功しましたが、ロメコインの減算に失敗しました。手動で確認してください。');
                            } else if (deductData.success && deductData.newBalance !== undefined) {
                                // 成功時のレスポンス: { success: true, userId, deducted, previousBalance, newBalance }
                                newBalance = deductData.newBalance;
                            } else {
                                console.error('ロメコイン減算レスポンス形式エラー:', deductData);
                                console.error('部活作成は成功しましたが、ロメコインの減算に失敗しました。手動で確認してください。');
                            }
                        } catch (error) {
                            console.error('ロメコイン減算エラー:', error);
                            // 部活は作成済みなので、エラーログを残すが処理は続行
                            console.error('部活作成は成功しましたが、ロメコインの減算に失敗しました。手動で確認してください。');
                        }
                        
                        // 成功メッセージに残高を表示
                        let successMessage = `部活「${clubName}」を人気部活カテゴリに設立しました！ ${newChannel} を確認してください。`;
                        if (newBalance > 0) {
                            successMessage += `\n残りのロメコイン: <:romecoin2:1452874868415791236> ${newBalance.toLocaleString()}`;
                        }
                        await interaction.editReply({ content: successMessage });
                        // 部活作成完了後にクールダウンを設定（Redis使用）
                        const cooldownEnd = Date.now() + config.CLUB_CREATION_COOLDOWN;
                        await redis.setex(cooldownKey, Math.ceil(config.CLUB_CREATION_COOLDOWN / 1000), cooldownEnd.toString());
                        console.log(`部活作成クールダウン設定: ユーザー ${interaction.user.id}, 終了時刻: ${new Date(cooldownEnd).toLocaleString()}`);

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

                        // 部活作成通知チャンネルに埋め込みメッセージを送信
                        try {
                            const notificationChannel = await interaction.guild.channels.fetch(config.RESTART_NOTIFICATION_CHANNEL_ID);
                            if (notificationChannel) {
                                await notificationChannel.send({ embeds: [clubEmbed] });
                            }
                        } catch (error) {
                            console.error('部活作成通知チャンネルへの埋め込みメッセージ送信エラー:', error);
                        }

                    } catch (error) {
                        console.error('部活作成プロセス中にエラー:', error);
                        await interaction.editReply({ content: 'エラーが発生し、部活を作成できませんでした。' });
                    }
                }
            }
        } catch (error) {
            console.error('インタラクション処理中に予期せぬエラーが発生しました:', error);
            
            // Discord API エラーコード10062（Unknown interaction）の特別処理
            if (error.code === 10062) {
                console.log(`インタラクション ${interaction.id} は既に期限切れまたは処理済みです`);
                return; // エラーレスポンスを送信しない
            }
            
            // インタラクションが既に応答済みかどうかを確認
            if (interaction.replied || interaction.deferred) {
                try {
                    await interaction.followUp({ content: 'コマンドの実行中にエラーが発生しました。', flags: [MessageFlags.Ephemeral] });
                } catch (followUpError) {
                    console.error('followUpエラー:', followUpError);
                }
            } else {
                try {
                    await interaction.reply({ content: 'コマンドの実行中にエラーが発生しました。', flags: [MessageFlags.Ephemeral] });
                } catch (replyError) {
                    console.error('replyエラー:', replyError);
                    // replyも失敗した場合は、エラーをログに記録するだけ
                }
            }
        }
	},
};
