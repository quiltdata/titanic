import { tableExists, executeQuery } from "../shared/athena-utils";
import { TableContext } from "../shared/types";

export class PackageTagTable {
    private static readonly TABLE_NAME = "package_tag";

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
              registry   STRING,      
              pkg_name   STRING,      
              tag_name   STRING,      
              top_hash   STRING       
            )
            PARTITIONED BY (
              registry,
              tag_name,
              bucket(8, pkg_name)
            )
        `;

        await executeQuery(createQuery, targetBucket);
    }

    static generateInsertQuery(context: TableContext, sourceTableName: string): string {
        return `
            INSERT INTO "${context.databaseName}"."${this.TABLE_NAME}" (registry, pkg_name, tag_name, top_hash)
            SELECT DISTINCT
              '${context.registryName}' AS registry,
              s.pkg_name,
              s.timestamp AS tag_name,
              s.top_hash
            FROM "${context.databaseName}"."${sourceTableName}" s
            LEFT JOIN "${context.databaseName}"."${this.TABLE_NAME}" t
              ON s.pkg_name = t.pkg_name
              AND s.timestamp = t.tag_name
              AND t.registry = '${context.registryName}'
            WHERE s.timestamp = 'latest'
              AND (t.top_hash IS NULL OR s.top_hash != t.top_hash)`;
    }

    static async insert(context: TableContext, sourceTableName: string): Promise<void> {
        const query = this.generateInsertQuery(context, sourceTableName);
        await executeQuery(query, context.targetBucket);
    }
}
