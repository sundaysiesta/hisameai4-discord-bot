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
}

module.exports = new MemoryManager(); 