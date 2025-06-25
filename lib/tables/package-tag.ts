import { BaseTable } from "./base-table";
import { TableContext } from "../shared/types";

export class PackageTagTable extends BaseTable {
    protected get tableName(): string {
        return "package_tag";
    }

    protected getCreateTableSchema(databaseName: string): string {
        return `
            CREATE TABLE IF NOT EXISTS "${databaseName}"."${this.tableName}" (
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
    }

    protected generateInsertQuery(context: TableContext, sourceTableName: string): string {
        return `
            INSERT INTO "${context.databaseName}"."${this.tableName}" (registry, pkg_name, tag_name, top_hash)
            SELECT DISTINCT
              '${context.registryName}' AS registry,
              s.pkg_name,
              s.timestamp AS tag_name,
              s.top_hash
            FROM "${context.databaseName}"."${sourceTableName}" s
            LEFT JOIN "${context.databaseName}"."${this.tableName}" t
              ON s.pkg_name = t.pkg_name
              AND s.timestamp = t.tag_name
              AND t.registry = '${context.registryName}'
            WHERE s.timestamp = 'latest'
              AND (t.top_hash IS NULL OR s.top_hash != t.top_hash)`;
    }
}
