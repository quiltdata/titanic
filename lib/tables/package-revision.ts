import { tableExists, executeQuery } from "../shared/athena-utils";
import { TableContext } from "../shared/types";

export class PackageRevisionTable {
    private static readonly TABLE_NAME = "package_revision";

    static async ensureExists(
        databaseName: string,
        targetBucket: string,
        sourceView: string
    ): Promise<void> {
        if (await tableExists(databaseName, this.TABLE_NAME)) {
            return;
        }

        console.log(`Creating ${this.TABLE_NAME} table using separate CREATE and INSERT`);
        await this.createTable(databaseName, targetBucket);
    }

    private static async createTable(
        databaseName: string,
        targetBucket: string
    ): Promise<void> {
        const createQuery = `
            CREATE TABLE IF NOT EXISTS "${databaseName}"."${this.TABLE_NAME}" (
              registry     STRING,   
              pkg_name     STRING,   
              top_hash     STRING,   
              timestamp    TIMESTAMP, 
              message      STRING,   
              metadata    STRING       
            )
            PARTITIONED BY (
              registry,
              bucket(8, pkg_name),
              bucket(8, top_hash)
            )
        `;

        await executeQuery(createQuery, targetBucket);
    }

    static generateInsertQuery(context: TableContext, sourceTableName: string): string {
        return `
            INSERT INTO "${context.databaseName}"."${this.TABLE_NAME}" (registry, pkg_name, top_hash, timestamp, message, metadata)
            SELECT DISTINCT
              '${context.registryName}' AS registry,
              s.pkg_name,
              s.top_hash,
              from_unixtime(CAST(s.timestamp AS bigint)) AS timestamp,
              s.message,
              s.user_meta AS metadata
            FROM "${context.databaseName}"."${sourceTableName}" s
            LEFT JOIN "${context.databaseName}"."${this.TABLE_NAME}" t
              ON s.pkg_name = t.pkg_name
              AND s.top_hash = t.top_hash
              AND t.registry = '${context.registryName}'
            WHERE t.pkg_name IS NULL
              AND s.timestamp != 'latest'`;
    }

    static async insert(context: TableContext, sourceTableName: string): Promise<void> {
        const query = this.generateInsertQuery(context, sourceTableName);
        await executeQuery(query, context.targetBucket);
    }
}
