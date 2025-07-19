class MemoryManager {
    constructor() {
        this.memoryThreshold = 400; // 400MB
        this.cleanupInterval = 5 * 60 * 1000; // 5分
        this.lastCleanup = Date.now();
        this.setupPeriodicCleanup();
    }

    // メモリ使用量を監視
    checkMemoryUsage() {
        const memUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
        
        console.log(`メモリ使用量: ${heapUsedMB}MB / ${heapTotalMB}MB`);
        
        if (heapUsedMB > this.memoryThreshold) {
            console.warn(`⚠️ メモリ使用量が閾値を超えています: ${heapUsedMB}MB`);
            this.forceCleanup();
            return false;
        }
        
        return true;
    }

    // 強制クリーンアップ
    forceCleanup() {
        console.log('🧹 メモリクリーンアップを実行中...');
        
        // ガベージコレクションを強制実行
        if (global.gc) {
            global.gc();
            console.log('✅ ガベージコレクション完了');
        }
        
        // グローバル変数のクリーンアップ
        if (global.anonymousCooldown) {
            const now = Date.now();
            const cooldownTimeout = 5 * 60 * 1000; // 5分
            
            Object.keys(global.anonymousCooldown).forEach(userId => {
                if (now - global.anonymousCooldown[userId] > cooldownTimeout) {
                    delete global.anonymousCooldown[userId];
                }
            });
        }

        // 代理投稿クールダウンのクリーンアップ
        if (global.proxyCooldown) {
            const now = Date.now();
            const cooldownTimeout = 2 * 60 * 1000; // 2分
            
            Object.keys(global.proxyCooldown).forEach(userId => {
                if (now - global.proxyCooldown[userId] > cooldownTimeout) {
                    delete global.proxyCooldown[userId];
                }
            });
        }

        // 代理投稿削除マップのクリーンアップ
        if (global.proxyDeleteMap) {
            const now = Date.now();
            const deleteMapTimeout = 24 * 60 * 60 * 1000; // 24時間
            
            // 古いメッセージIDを削除（実際のメッセージ削除は別途処理）
            // ここではメモリ上の古いデータのみをクリーンアップ
            console.log(`代理投稿削除マップ: ${Object.keys(global.proxyDeleteMap).length}件のエントリ`);
        }
        
        this.lastCleanup = Date.now();
    }

    // 定期的なクリーンアップ
    setupPeriodicCleanup() {
        setInterval(() => {
            const now = Date.now();
            if (now - this.lastCleanup > this.cleanupInterval) {
                this.forceCleanup();
            }
        }, this.cleanupInterval);
    }

    // ファイルサイズの安全な検証
    validateFileSize(size, maxSize) {
        if (size > maxSize) {
            return {
                valid: false,
                error: `ファイルサイズが大きすぎます。最大${Math.round(maxSize / 1024 / 1024)}MBまで対応しています。`
            };
        }
        return { valid: true };
    }

    // ファイル形式の検証
    validateFileType(contentType, allowedTypes) {
        if (!allowedTypes.includes(contentType)) {
            return {
                valid: false,
                error: `サポートされていないファイル形式です。`
            };
        }
        return { valid: true };
    }

    // 安全なファイル処理
    async processFileSafely(fileUrl, maxSize) {
        try {
            const response = await fetch(fileUrl);
            if (!response.ok) {
                throw new Error('ファイルのダウンロードに失敗しました');
            }
            
            const buffer = await response.arrayBuffer();
            if (buffer.byteLength > maxSize) {
                throw new Error('ファイルサイズが制限を超えています');
            }
            
            return Buffer.from(buffer);
        } catch (error) {
            console.error('ファイル処理エラー:', error);
            throw error;
        }
    }

    // 代理投稿クールダウン管理
    checkProxyCooldown(userId, cooldownTime = 10 * 1000) {
        if (!global.proxyCooldown) global.proxyCooldown = {};
        
        const now = Date.now();
        const last = global.proxyCooldown[userId] || 0;
        
        if (now - last < cooldownTime) {
            return {
                onCooldown: true,
                remainingTime: Math.ceil((cooldownTime - (now - last)) / 1000)
            };
        }
        
        global.proxyCooldown[userId] = now;
        return { onCooldown: false };
    }
}

module.exports = new MemoryManager(); 