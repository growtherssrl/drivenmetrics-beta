#!/usr/bin/env node

/**
 * Cleanup Script for DrivenMetrics MCP System
 * Rimuove file temporanei, organizza il codice e ottimizza il sistema
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Configurazione
const config = {
    dryRun: false,  // Se true, mostra solo cosa verrebbe fatto senza modificare
    interactive: true,  // Chiede conferma prima di eliminare
    backupDir: './backup_' + new Date().toISOString().split('T')[0]
};

// File da rimuovere
const filesToRemove = {
    tests: [
        'test-session.js',
        'test-supabase-direct.js',
        'debug-n8n-truncation.js',
        'n8n-code-node-fixed.js',
        'test-mcp-system.js',  // Opzionale, potrebbe essere utile tenerlo
        'public/test-chat.html',
        'public/test-streaming.html',
        'public/test-n8n-widget.html'
    ],
    logs: [
        'server.log',
        'test-report.json',
        '*.log'
    ],
    temp: [
        'CLAUDE.md',
        '.claude_data.json'
    ],
    optional: [
        'public/custom-chat.html',  // Versione standalone, ora abbiamo integrated-custom-chat
        'src/routes/chat.js'  // Route separate, ora integrate in index.ts
    ]
};

// Directory da pulire
const dirsToClean = [
    'node_modules/.cache',
    'dist',
    '.npm'
];

// Helper functions
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function formatSize(bytes) {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

function getFileSize(filePath) {
    try {
        const stats = fs.statSync(filePath);
        return stats.size;
    } catch {
        return 0;
    }
}

function fileExists(filePath) {
    try {
        return fs.existsSync(filePath);
    } catch {
        return false;
    }
}

async function createBackup(files) {
    if (config.dryRun) return;
    
    console.log(`\n📦 Creating backup in ${config.backupDir}...`);
    
    if (!fs.existsSync(config.backupDir)) {
        fs.mkdirSync(config.backupDir, { recursive: true });
    }
    
    let backedUp = 0;
    for (const file of files) {
        if (fileExists(file)) {
            const backupPath = path.join(config.backupDir, path.basename(file));
            try {
                fs.copyFileSync(file, backupPath);
                backedUp++;
            } catch (err) {
                console.log(`  ⚠️  Failed to backup ${file}: ${err.message}`);
            }
        }
    }
    
    console.log(`  ✅ Backed up ${backedUp} files`);
}

async function removeFiles(category, files) {
    console.log(`\n🗑️  ${category}:`);
    
    let totalSize = 0;
    let removedCount = 0;
    const existingFiles = [];
    
    for (const file of files) {
        if (file.includes('*')) {
            // Handle wildcards
            const dir = path.dirname(file) || '.';
            const pattern = path.basename(file).replace('*', '.*');
            const regex = new RegExp(pattern);
            
            try {
                const dirFiles = fs.readdirSync(dir);
                for (const dirFile of dirFiles) {
                    if (regex.test(dirFile)) {
                        const fullPath = path.join(dir, dirFile);
                        const size = getFileSize(fullPath);
                        if (size > 0) {
                            existingFiles.push({ path: fullPath, size });
                            totalSize += size;
                        }
                    }
                }
            } catch (err) {
                // Directory doesn't exist
            }
        } else {
            const size = getFileSize(file);
            if (size > 0) {
                existingFiles.push({ path: file, size });
                totalSize += size;
            }
        }
    }
    
    if (existingFiles.length === 0) {
        console.log('  ✓ No files to remove');
        return { removed: 0, savedSpace: 0 };
    }
    
    console.log(`  Found ${existingFiles.length} files (${formatSize(totalSize)})`);
    
    if (config.interactive && !config.dryRun) {
        const answer = await question(`  Remove these files? (y/n): `);
        if (answer.toLowerCase() !== 'y') {
            console.log('  Skipped');
            return { removed: 0, savedSpace: 0 };
        }
    }
    
    for (const { path: filePath, size } of existingFiles) {
        if (config.dryRun) {
            console.log(`  [DRY RUN] Would remove: ${filePath} (${formatSize(size)})`);
            removedCount++;
        } else {
            try {
                fs.unlinkSync(filePath);
                console.log(`  ✓ Removed: ${filePath} (${formatSize(size)})`);
                removedCount++;
            } catch (err) {
                console.log(`  ✗ Failed to remove ${filePath}: ${err.message}`);
            }
        }
    }
    
    return { removed: removedCount, savedSpace: totalSize };
}

async function cleanDirectories() {
    console.log('\n📁 Cleaning directories:');
    
    let totalCleaned = 0;
    
    for (const dir of dirsToClean) {
        if (fs.existsSync(dir)) {
            try {
                const stats = fs.statSync(dir);
                if (stats.isDirectory()) {
                    if (config.dryRun) {
                        console.log(`  [DRY RUN] Would clean: ${dir}`);
                    } else {
                        fs.rmSync(dir, { recursive: true, force: true });
                        console.log(`  ✓ Cleaned: ${dir}`);
                        totalCleaned++;
                    }
                }
            } catch (err) {
                console.log(`  ✗ Failed to clean ${dir}: ${err.message}`);
            }
        }
    }
    
    if (totalCleaned === 0 && !config.dryRun) {
        console.log('  ✓ No directories to clean');
    }
    
    return totalCleaned;
}

async function optimizePackageJson() {
    console.log('\n📦 Optimizing package.json:');
    
    try {
        const packagePath = './package.json';
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        
        // Remove unused scripts
        const unusedScripts = ['test', 'lint', 'format'];
        let removed = 0;
        
        if (packageJson.scripts) {
            for (const script of unusedScripts) {
                if (packageJson.scripts[script]) {
                    delete packageJson.scripts[script];
                    removed++;
                    console.log(`  ✓ Removed unused script: ${script}`);
                }
            }
        }
        
        if (removed > 0 && !config.dryRun) {
            fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
            console.log(`  ✓ Updated package.json`);
        } else if (removed === 0) {
            console.log('  ✓ package.json already optimized');
        }
        
    } catch (err) {
        console.log(`  ✗ Failed to optimize package.json: ${err.message}`);
    }
}

async function createGitignore() {
    console.log('\n📝 Updating .gitignore:');
    
    const gitignoreContent = `# Dependencies
node_modules/
.npm/

# Environment
.env
.env.local
.env.*.local

# Logs
*.log
npm-debug.log*
server.log

# Build
dist/
build/
*.tsbuildinfo

# Testing
coverage/
test-report.json
*.test.js
*.spec.js

# IDE
.vscode/
.idea/
*.swp
*.swo
.DS_Store

# Temporary
*.tmp
*.temp
temp/
tmp/
backup_*/

# Cache
.cache/
node_modules/.cache/

# Session
sessions/
.sessions/

# Supabase
supabase/.branches
supabase/.temp

# MCP/Claude specific
.claude_data.json
CLAUDE.md
`;

    if (config.dryRun) {
        console.log('  [DRY RUN] Would update .gitignore');
    } else {
        fs.writeFileSync('.gitignore', gitignoreContent);
        console.log('  ✓ Updated .gitignore with comprehensive rules');
    }
}

async function generateCleanupReport(stats) {
    const report = {
        timestamp: new Date().toISOString(),
        mode: config.dryRun ? 'DRY RUN' : 'EXECUTED',
        stats: {
            filesRemoved: stats.totalRemoved,
            spaceFreed: formatSize(stats.totalSpace),
            directoriesCleaned: stats.dirsCleared,
            categories: stats.categories
        }
    };
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 CLEANUP SUMMARY');
    console.log('='.repeat(50));
    console.log(`Mode: ${report.mode}`);
    console.log(`Files removed: ${report.stats.filesRemoved}`);
    console.log(`Space freed: ${report.stats.spaceFreed}`);
    console.log(`Directories cleaned: ${report.stats.directoriesCleaned}`);
    
    if (!config.dryRun) {
        const reportPath = './cleanup-report.json';
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\nReport saved to: ${reportPath}`);
    }
}

// Main cleanup function
async function runCleanup() {
    console.log('🧹 DrivenMetrics System Cleanup\n');
    console.log('='.repeat(50));
    
    // Check for flags
    const args = process.argv.slice(2);
    if (args.includes('--dry-run')) {
        config.dryRun = true;
        console.log('🔍 DRY RUN MODE - No files will be modified\n');
    }
    if (args.includes('--force')) {
        config.interactive = false;
        console.log('⚡ FORCE MODE - No confirmations\n');
    }
    
    const stats = {
        totalRemoved: 0,
        totalSpace: 0,
        dirsCleared: 0,
        categories: {}
    };
    
    try {
        // Create backup if not dry run
        if (!config.dryRun && config.interactive) {
            const answer = await question('Create backup before cleanup? (y/n): ');
            if (answer.toLowerCase() === 'y') {
                const allFiles = [
                    ...filesToRemove.tests,
                    ...filesToRemove.logs,
                    ...filesToRemove.temp,
                    ...filesToRemove.optional
                ];
                await createBackup(allFiles);
            }
        }
        
        // Remove test files
        const testStats = await removeFiles('Test Files', filesToRemove.tests);
        stats.categories['tests'] = testStats;
        stats.totalRemoved += testStats.removed;
        stats.totalSpace += testStats.savedSpace;
        
        // Remove log files
        const logStats = await removeFiles('Log Files', filesToRemove.logs);
        stats.categories['logs'] = logStats;
        stats.totalRemoved += logStats.removed;
        stats.totalSpace += logStats.savedSpace;
        
        // Remove temp files
        const tempStats = await removeFiles('Temporary Files', filesToRemove.temp);
        stats.categories['temp'] = tempStats;
        stats.totalRemoved += tempStats.removed;
        stats.totalSpace += tempStats.savedSpace;
        
        // Optional files (ask user)
        if (config.interactive) {
            console.log('\n⚠️  Optional files (may still be useful):');
            for (const file of filesToRemove.optional) {
                if (fileExists(file)) {
                    console.log(`  - ${file}`);
                }
            }
            const answer = await question('Remove optional files? (y/n): ');
            if (answer.toLowerCase() === 'y') {
                const optionalStats = await removeFiles('Optional Files', filesToRemove.optional);
                stats.categories['optional'] = optionalStats;
                stats.totalRemoved += optionalStats.removed;
                stats.totalSpace += optionalStats.savedSpace;
            }
        }
        
        // Clean directories
        stats.dirsCleared = await cleanDirectories();
        
        // Optimize package.json
        await optimizePackageJson();
        
        // Update .gitignore
        await createGitignore();
        
        // Generate report
        await generateCleanupReport(stats);
        
    } catch (error) {
        console.error('\n❌ Cleanup error:', error.message);
    } finally {
        rl.close();
    }
}

// Run cleanup
runCleanup();