const { SlashCommandBuilder, PermissionsBitField, MessageFlags, ChannelType } = require('discord.js');
const config = require('../config.js');
const { notion, getNotionRelationTitles } = require('../utils/notionHelpers.js');
const { getGenerationRoleName, setDiscordIconToNotion } = require('../utils/utility.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('link')
        .setDescription('DiscordアカウントとNotionの名前を紐付けます。(管理者限定)')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('紐付けたいDiscordユーザー名')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('name')
                .setDescription('Notionデータベース上の正確な名前（タイトル）')
                .setRequired(true)),
    async execute(interaction, redis, notion) {
        const ALLOWED_ROLE_ID = '1449784235102703667';
        const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
        const hasAllowedRole = interaction.member.roles.cache.has(ALLOWED_ROLE_ID);
        
        if (!isAdmin && !hasAllowedRole) {
            return interaction.reply({ content: 'このコマンドを使用する権限がありません。', flags: [MessageFlags.Ephemeral] });
        }
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const targetUser = interaction.options.getUser('user');
        const characterName = interaction.options.getString('name');

        try {
            const response = await notion.databases.query({
                database_id: config.NOTION_DATABASE_ID,
                filter: { property: '名前', title: { equals: characterName } },
            });
            if (response.results.length === 0) {
                return interaction.editReply(`名前「${characterName}」が見つかりませんでした。`);
            }
            
            const page = response.results[0];
            const pageId = page.id;
            const props = page.properties;

            // 既存のDiscordユーザーIDを取得
            const existingDiscordUserId = props['DiscordユーザーID']?.rich_text?.[0]?.plain_text;
            
            // 既存のDiscordユーザーIDが存在し、かつ新しいユーザーIDと異なる場合の処理
            if (existingDiscordUserId && existingDiscordUserId !== targetUser.id) {
                try {
                    const existingMember = await interaction.guild.members.fetch(existingDiscordUserId).catch(() => null);
                    if (existingMember) {
                        // 被爆ロールを付与
                        const hibakuRoleId = '1431905155913089124';
                        const hibakuRole = await interaction.guild.roles.fetch(hibakuRoleId).catch(() => null);
                        if (hibakuRole) {
                            await existingMember.roles.add(hibakuRole);
                            console.log(`[Link] 既存のDiscordユーザーID (${existingDiscordUserId}) に被爆ロールを付与しました。`);
                        } else {
                            console.error(`[Link] 被爆ロール (${hibakuRoleId}) が見つかりませんでした。`);
                        }
                        
                        // 世代ロールを剥奪（ローマ数字のロール名を持つロールを検索）
                        const romanNumeralPattern = /^[IVXLCDM]+$/; // ローマ数字のパターン
                        const generationRoles = existingMember.roles.cache.filter(role => 
                            romanNumeralPattern.test(role.name) && role.name !== '@everyone'
                        );
                        
                        for (const role of generationRoles.values()) {
                            try {
                                await existingMember.roles.remove(role);
                                console.log(`[Link] 既存ユーザー (${existingDiscordUserId}) から世代ロール「${role.name}」を剥奪しました。`);
                            } catch (removeError) {
                                console.error(`[Link] 世代ロール「${role.name}」の剥奪エラー:`, removeError);
                            }
                        }
                    } else {
                        console.log(`[Link] 既存のDiscordユーザーID (${existingDiscordUserId}) のメンバーが見つかりませんでした。`);
                    }
                    
                    // データ移行処理（ロメコイン含む全データ）
                    if (config.CROSSROID_API_URL && config.CROSSROID_API_TOKEN) {
                        try {
                            const migrateController = new AbortController();
                            const migrateTimeoutId = setTimeout(() => migrateController.abort(), 10000); // 移行処理は時間がかかる可能性があるため10秒
                            
                            // 移行APIを呼び出し（既存ユーザーIDから新しいユーザーIDへ全データ移行）
                            const migrateResponse = await fetch(`${config.CROSSROID_API_URL}/api/migrate/${existingDiscordUserId}`, {
                                method: 'POST',
                                headers: {
                                    'x-api-token': config.CROSSROID_API_TOKEN,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({ newUserId: targetUser.id }),
                                signal: migrateController.signal
                            });
                            
                            clearTimeout(migrateTimeoutId);
                            
                            if (migrateResponse.ok) {
                                const migrateData = await migrateResponse.json().catch(() => ({}));
                                console.log(`[Link] データ移行が完了しました: ${existingDiscordUserId} → ${targetUser.id}`, migrateData);
                            } else {
                                const errorBody = await migrateResponse.text().catch(() => '');
                                console.error(`[Link] データ移行エラー: ${migrateResponse.status} ${errorBody}`);
                                
                                // 移行APIが失敗した場合、従来のロメコイン引き継ぎ処理をフォールバックとして実行
                                console.log(`[Link] 移行API失敗のため、ロメコイン引き継ぎ処理をフォールバックとして実行します。`);
                                try {
                                    // 既存ユーザーの残高を取得
                                    const balanceController = new AbortController();
                                    const balanceTimeoutId = setTimeout(() => balanceController.abort(), 5000);
                                    
                                    const balanceResponse = await fetch(`${config.CROSSROID_API_URL}/api/romecoin/${existingDiscordUserId}`, {
                                        headers: {
                                            'x-api-token': config.CROSSROID_API_TOKEN
                                        },
                                        signal: balanceController.signal
                                    });
                                    
                                    clearTimeout(balanceTimeoutId);
                                    
                                    if (balanceResponse.ok) {
                                        const balanceData = await balanceResponse.json();
                                        const currentBalance = balanceData.balance || 0;
                                        
                                        if (currentBalance > 0) {
                                            // 既存ユーザーから全額削除
                                            const deductController = new AbortController();
                                            const deductTimeoutId = setTimeout(() => deductController.abort(), 5000);
                                            
                                            const deductResponse = await fetch(`${config.CROSSROID_API_URL}/api/romecoin/${existingDiscordUserId}/deduct`, {
                                                method: 'POST',
                                                headers: {
                                                    'x-api-token': config.CROSSROID_API_TOKEN,
                                                    'Content-Type': 'application/json'
                                                },
                                                body: JSON.stringify({ amount: currentBalance }),
                                                signal: deductController.signal
                                            });
                                            
                                            clearTimeout(deductTimeoutId);
                                            
                                            if (deductResponse.ok) {
                                                // 新しいユーザーに全額追加
                                                const addController = new AbortController();
                                                const addTimeoutId = setTimeout(() => addController.abort(), 5000);
                                                
                                                const addResponse = await fetch(`${config.CROSSROID_API_URL}/api/romecoin/${targetUser.id}/add`, {
                                                    method: 'POST',
                                                    headers: {
                                                        'x-api-token': config.CROSSROID_API_TOKEN,
                                                        'Content-Type': 'application/json'
                                                    },
                                                    body: JSON.stringify({ amount: currentBalance }),
                                                    signal: addController.signal
                                                });
                                                
                                                clearTimeout(addTimeoutId);
                                                
                                                if (addResponse.ok) {
                                                    const addData = await addResponse.json();
                                                    console.log(`[Link] ロメコインを引き継ぎました（フォールバック）: ${existingDiscordUserId} (${currentBalance}) → ${targetUser.id} (${addData.balance || currentBalance})`);
                                                } else {
                                                    const errorBody = await addResponse.text().catch(() => '');
                                                    console.error(`[Link] ロメコイン追加エラー（フォールバック）: ${addResponse.status} ${errorBody}`);
                                                }
                                            } else {
                                                const errorBody = await deductResponse.text().catch(() => '');
                                                console.error(`[Link] ロメコイン削除エラー（フォールバック）: ${deductResponse.status} ${errorBody}`);
                                            }
                                        } else {
                                            console.log(`[Link] 既存ユーザー (${existingDiscordUserId}) のロメコイン残高が0のため、引き継ぎ処理をスキップしました。`);
                                        }
                                    } else {
                                        console.error(`[Link] ロメコイン残高取得エラー（フォールバック）: ${balanceResponse.status}`);
                                    }
                                } catch (fallbackError) {
                                    console.error(`[Link] フォールバック処理エラー:`, fallbackError);
                                }
                            }
                        } catch (migrateError) {
                            console.error(`[Link] データ移行エラー:`, migrateError);
                        }
                    } else {
                        console.log(`[Link] CROSSROID_API_URLまたはCROSSROID_API_TOKENが設定されていないため、データ移行処理をスキップしました。`);
                    }
                } catch (hibakuError) {
                    console.error(`[Link] 既存ユーザー処理エラー:`, hibakuError);
                }
            }

            await notion.pages.update({
                page_id: pageId,
                properties: {
                    'DiscordユーザーID': { rich_text: [{ text: { content: targetUser.id } }] },
                },
            });

            const targetMember = await interaction.guild.members.fetch(targetUser.id);
            let addedRoles = [];

            // 称号ロールを付与
            const titleNames = await getNotionRelationTitles(notion, props['称号']);
            for (const roleName of titleNames) {
                const role = interaction.guild.roles.cache.find(r => r.name === roleName);
                if (role) {
                    await targetMember.roles.add(role).catch(e => console.error(`Failed to add role ${roleName}:`, e));
                    addedRoles.push(role.name);
                }
            }

            // 世代ロールを付与
            const generationNames = await getNotionRelationTitles(notion, props['世代']);
            if(generationNames.length > 0) {
                const romanRoleName = getGenerationRoleName(generationNames[0]);
                if (romanRoleName) {
                    const role = interaction.guild.roles.cache.find(r => r.name === romanRoleName);
                    if (role) {
                        await targetMember.roles.add(role).catch(e => console.error(`Failed to add role ${romanRoleName}:`, e));
                        addedRoles.push(role.name);
                    }
                }
            }
            
            // 【追加】危険等級ロールを付与
            const hazardNames = await getNotionRelationTitles(notion, props['危険等級']);
            for (const roleName of hazardNames) {
                const role = interaction.guild.roles.cache.find(r => r.name === roleName);
                if (role) {
                    await targetMember.roles.add(role).catch(e => console.error(`Failed to add role ${roleName}:`, e));
                    addedRoles.push(role.name);
                }
            }

            // 新方式: Notionの『部長』に記録されたチャンネルIDに対して部長設定と権限付与
            let leaderChannelsSet = [];
            try {
                const managerChannelsRaw = props['部長'];
                const channelsText = (managerChannelsRaw && managerChannelsRaw.rich_text && managerChannelsRaw.rich_text[0]?.plain_text) ? managerChannelsRaw.rich_text[0].plain_text : '';
                const channelIds = channelsText.split(',').map(s => s.trim()).filter(Boolean);
                
                for (const chId of channelIds) {
                    try {
                        const ch = await interaction.guild.channels.fetch(chId).catch(() => null);
                        if (!ch || ch.type !== ChannelType.GuildText) {
                            console.log(`[Link] チャンネル ${chId} が見つからないか、テキストチャンネルではありません。`);
                            continue;
                        }
                        
                        // 部活チャンネルかどうかチェック
                        const isClubChannel = (
                            ch.parent && (
                                config.CLUB_CATEGORIES.includes(ch.parent.id) ||
                                ch.parent.id === config.POPULAR_CLUB_CATEGORY_ID ||
                                ch.parent.id === config.INACTIVE_CLUB_CATEGORY_ID ||
                                ch.parent.id === config.ARCHIVE_CATEGORY_ID ||
                                ch.parent.id === config.ARCHIVE_OVERFLOW_CATEGORY_ID
                            )
                        );
                        
                        if (!isClubChannel) {
                            console.log(`[Link] チャンネル ${ch.name} (${chId}) は部活チャンネルではありません。`);
                            continue;
                        }
                        
                        // 既存の部長の権限を削除（Redisから取得）
                        const currentLeaderId = await redis.get(`leader_user:${chId}`);
                        if (currentLeaderId && currentLeaderId !== targetUser.id) {
                            try {
                                await ch.permissionOverwrites.delete(currentLeaderId);
                                console.log(`[Link] 既存の部長（ID: ${currentLeaderId}）の権限を削除しました。チャンネル: ${ch.name}`);
                            } catch (error) {
                                console.error(`[Link] 既存の部長の権限削除エラー:`, error);
                            }
                        }
                        
                        // Redisに部長情報を保存
                        await redis.set(`leader_user:${chId}`, targetUser.id);
                        
                        // チャンネル権限を設定
                        await ch.permissionOverwrites.edit(targetUser.id, {
                            ViewChannel: true,
                            ManageMessages: true,
                            ManageRoles: true
                        });
                        
                        leaderChannelsSet.push(ch.name);
                        console.log(`[Link] チャンネル ${ch.name} (${chId}) の部長を ${targetUser.username} に設定し、権限を付与しました。`);
                    } catch (channelError) {
                        console.error(`[Link] チャンネル ${chId} の処理エラー:`, channelError);
                    }
                }
            } catch (e) {
                console.error('部長権限付与エラー:', e);
            }

            // DiscordアイコンをNotionに自動同期
            try {
                const iconResult = await setDiscordIconToNotion(interaction.client, notion, config, targetUser.id);
                if (iconResult.success) {
                    console.log(`[Link] アイコン同期成功: ${targetUser.username} -> ${characterName}`);
                } else {
                    console.log(`[Link] アイコン同期失敗: ${targetUser.username} - ${iconResult.error}`);
                }
            } catch (iconError) {
                console.error(`[Link] アイコン同期エラー: ${targetUser.username}`, iconError);
            }

            let replyMessage = `成功！ ${targetUser.username} を「${characterName}」に紐付けました。`;
            if (addedRoles.length > 0) {
                replyMessage += `\n付与されたロール: ${addedRoles.join(', ')}`;
            }
            if (leaderChannelsSet.length > 0) {
                replyMessage += `\n部長に設定されたチャンネル: ${leaderChannelsSet.join(', ')}`;
            }
            replyMessage += `\nDiscordアイコンをNotionに同期しました。`;

            await interaction.editReply(replyMessage);

        } catch (error) {
            console.error('Notion API /link error:', error);
            await interaction.editReply('Notionとの連携中にエラーが発生しました。');
        }
    },
};
