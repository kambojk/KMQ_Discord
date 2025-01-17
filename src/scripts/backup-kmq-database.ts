/* eslint-disable node/no-sync */
import * as cp from "child_process";
import { IPCLogger } from "../logger";
import { join } from "path";
import { program } from "commander";
import { standardDateFormat } from "../helpers/utils";
import fs from "fs";

const BACKUP_TTL = 30;

const databaseBackupDir = join(__dirname, "../../sql_dumps/kmq_backup");

const logger = new IPCLogger("backup-kmq");
program.option("-i, --import <file>", "The dump file to import");

program.parse();
const options = program.opts();

/**
 * Backups the current KMQ database
 */
async function backupKmqDatabase(): Promise<void> {
    if (!fs.existsSync(databaseBackupDir)) {
        fs.mkdirSync(databaseBackupDir);
    }

    cp.execSync(
        `find ${databaseBackupDir} -mindepth 1 -name "*kmq_backup_*" -mtime +${BACKUP_TTL} -delete`
    );

    return new Promise((resolve, reject) => {
        cp.exec(
            `mysqldump -u ${process.env.DB_USER} -p${process.env.DB_PASS} -h ${
                process.env.DB_HOST
            } --port ${
                process.env.DB_PORT
            } --routines kmq > ${databaseBackupDir}/kmq_backup_${standardDateFormat(
                new Date()
            )}.sql`,
            (err) => {
                if (err) {
                    logger.error(`Error backing up kmq database, err = ${err}`);
                    reject(err);
                    return;
                }

                resolve();
            }
        );
    });
}

function importKmqDatabase(fileWithPath: string): void {
    if (!fs.existsSync(fileWithPath)) {
        logger.error(`Dump file ${fileWithPath} doesn't exist.`);
        return;
    }

    logger.info(`Beginning import of ${fileWithPath}`);
    cp.execSync(
        `mysql -u ${process.env.DB_USER} -p${process.env.DB_PASS} -h ${process.env.DB_HOST} --port ${process.env.DB_PORT}  kmq < ${fileWithPath}`
    );
    logger.info("Finished import");
}

(() => {
    if (require.main === module) {
        if (options.import) {
            importKmqDatabase(options.import);
        } else {
            backupKmqDatabase();
        }
    }
})();

export default backupKmqDatabase;
