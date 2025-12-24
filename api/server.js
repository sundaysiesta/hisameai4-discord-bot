const http = require('http');
const url = require('url');
const config = require('../config.js');
const { calculateWeeklyActivity } = require('../utils/utility.js');
const { calculateWeeklyRanking } = require('../events/ready.js');

/**
 * 部活投資システム用APIサーバー
 * ヒサメbotからアクティブポイントを取得するためのAPI
 */
class ClubInvestmentAPI {
    constructor(client, redis) {
        this.client = client;
        this.redis = redis;
        this.server = null;
        this.apiToken = process.env.CLUB_INVESTMENT_API_TOKEN || config.CROSSROID_API_TOKEN;
    }

    /**
     * API認証チェック
     */
    checkAuth(req) {
        const token = req.headers['x-api-token'];
        return token === this.apiToken;
    }

    /**
     * JSONレスポンスを送信
     */
    sendJSON(res, statusCode, data) {
        res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
    }

    /**
     * エラーレスポンスを送信
     */
    sendError(res, statusCode, message) {
        this.sendJSON(res, statusCode, { error: message });
    }

    /**
     * 部活のアクティブポイントを取得
     * GET /api/club/activity/:channelId
     */
    async handleGetActivity(req, res, channelId) {
        try {
            // 認証チェック
            if (!this.checkAuth(req)) {
                return this.sendError(res, 401, 'Unauthorized: Invalid API token');
            }

            // ギルドを取得
            const guild = this.client.guilds.cache.first();
            if (!guild) {
                return this.sendError(res, 503, 'Service Unavailable: Guild not found');
            }

            // チャンネルを取得
            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel) {
                return this.sendError(res, 404, `Channel not found: ${channelId}`);
            }

            // 部活チャンネルかどうかチェック
            const isClubChannel = (
                channel.parent && (
                    config.CLUB_CATEGORIES.includes(channel.parent.id) ||
                    channel.parent.id === config.POPULAR_CLUB_CATEGORY_ID
                )
            );
            if (!isClubChannel) {
                return this.sendError(res, 400, `Channel is not a club channel: ${channelId}`);
            }

            // メモリ内のデータをRedisに反映（最新のアクティブポイントを取得するため）
            if (global.dailyMessageBuffer) {
                for (const [id, count] of Object.entries(global.dailyMessageBuffer)) {
                    if (id === channelId && count > 0) {
                        try {
                            await this.redis.incrby(`weekly_message_count:${id}`, count);
                            // 反映後はリセットしない（他の処理で使用される可能性があるため）
                        } catch (error) {
                            console.error(`[API] Redis反映エラー for channel ${id}:`, error);
                        }
                    }
                }
            }

            // アクティブポイントを計算
            const activity = await calculateWeeklyActivity(channel, this.redis);

            // ランキングを計算して順位を取得
            const ranking = await calculateWeeklyRanking(guild, this.redis);
            const rankIndex = ranking.findIndex(r => r.id === channelId);
            const rank = rankIndex !== -1 ? rankIndex + 1 : null;

            // レスポンスを返す
            this.sendJSON(res, 200, {
                channelId: channelId,
                activityPoint: activity.activityScore,
                rank: rank,
                activeMemberCount: activity.activeMemberCount,
                weeklyMessageCount: activity.weeklyMessageCount,
                lastUpdated: Math.floor(Date.now() / 1000)
            });
        } catch (error) {
            console.error(`[API] アクティブポイント取得エラー:`, error);
            this.sendError(res, 500, `Internal Server Error: ${error.message}`);
        }
    }

    /**
     * 部活一覧を取得
     * GET /api/club/list
     */
    async handleGetClubList(req, res) {
        try {
            // 認証チェック
            if (!this.checkAuth(req)) {
                return this.sendError(res, 401, 'Unauthorized: Invalid API token');
            }

            // ギルドを取得
            const guild = this.client.guilds.cache.first();
            if (!guild) {
                return this.sendError(res, 503, 'Service Unavailable: Guild not found');
            }

            // メモリ内のデータをRedisに反映
            if (global.dailyMessageBuffer) {
                for (const [channelId, count] of Object.entries(global.dailyMessageBuffer)) {
                    if (count > 0) {
                        try {
                            await this.redis.incrby(`weekly_message_count:${channelId}`, count);
                            // 反映後はリセットしない
                        } catch (error) {
                            console.error(`[API] Redis反映エラー for channel ${channelId}:`, error);
                        }
                    }
                }
            }

            // ランキングを計算
            const ranking = await calculateWeeklyRanking(guild, this.redis);

            // 部活一覧を構築
            const clubs = ranking.map(club => ({
                channelId: club.id,
                channelName: club.name,
                activityPoint: club.activityScore,
                rank: ranking.indexOf(club) + 1,
                activeMemberCount: club.activeMemberCount,
                weeklyMessageCount: club.messageCount
            }));

            // レスポンスを返す
            this.sendJSON(res, 200, {
                clubs: clubs,
                total: clubs.length,
                lastUpdated: Math.floor(Date.now() / 1000)
            });
        } catch (error) {
            console.error(`[API] 部活一覧取得エラー:`, error);
            this.sendError(res, 500, `Internal Server Error: ${error.message}`);
        }
    }

    /**
     * リクエストハンドラー
     */
    async handleRequest(req, res) {
        // CORSヘッダーを設定
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'x-api-token, content-type');

        // OPTIONSリクエスト（プリフライト）の処理
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;

        // ルーティング
        if (req.method === 'GET') {
            // GET /api/club/activity/:channelId
            const activityMatch = pathname.match(/^\/api\/club\/activity\/(\d+)$/);
            if (activityMatch) {
                const channelId = activityMatch[1];
                return await this.handleGetActivity(req, res, channelId);
            }

            // GET /api/club/list
            if (pathname === '/api/club/list') {
                return await this.handleGetClubList(req, res);
            }

            // ヘルスチェック
            if (pathname === '/health' || pathname === '/api/health') {
                return this.sendJSON(res, 200, { status: 'ok', timestamp: Math.floor(Date.now() / 1000) });
            }
        }

        // 404 Not Found
        this.sendError(res, 404, 'Not Found');
    }

    /**
     * HTTPサーバーを起動
     */
    start(port = 3000) {
        this.server = http.createServer((req, res) => {
            this.handleRequest(req, res).catch(error => {
                console.error('[API] リクエスト処理エラー:', error);
                if (!res.headersSent) {
                    this.sendError(res, 500, 'Internal Server Error');
                }
            });
        });

        this.server.listen(port, () => {
            console.log(`[API] 部活投資システムAPIサーバーが起動しました: http://localhost:${port}`);
            console.log(`[API] エンドポイント:`);
            console.log(`[API]   GET /api/club/activity/:channelId - 部活のアクティブポイントを取得`);
            console.log(`[API]   GET /api/club/list - 部活一覧を取得`);
            console.log(`[API]   GET /health - ヘルスチェック`);
        });

        this.server.on('error', (error) => {
            console.error('[API] サーバーエラー:', error);
        });
    }

    /**
     * HTTPサーバーを停止
     */
    stop() {
        if (this.server) {
            this.server.close(() => {
                console.log('[API] 部活投資システムAPIサーバーを停止しました');
            });
        }
    }
}

module.exports = ClubInvestmentAPI;

