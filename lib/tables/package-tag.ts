import { BaseTable } from "./base-table";
import { TableContext, ColumnDefinitions } from "../shared/types";

export class PackageTagTable extends BaseTable {
    protected get tableName(): string {
        return "package_tag";
    }

    protected getColumnDefinitions(): ColumnDefinitions {
        return {
            'registry': 'STRING',
            'pkg_name': 'STRING',
            'tag_name': 'STRING',
            'top_hash': 'STRING'
        };
    }

    protected getPartitioningClause(): string {
        return `PARTITIONED BY (
              registry,
              tag_name,
              bucket(8, pkg_name)
            )`;
    }

    protected generateSelectClause(registryName: string, sourceAlias: string): string {
        return `'${registryName}' AS registry,
              ${sourceAlias}.pkg_name,
              ${sourceAlias}.timestamp AS tag_name,
              ${sourceAlias}.top_hash`;
    }

    protected generateWhereClauseForCtas(sourceAlias: string): string {
        return `${sourceAlias}.timestamp = 'latest'`;
    }

    protected generateInsertQuery(context: TableContext, sourceTableName: string): string {
        const selectClause = this.generateSelectClause(context.registryName, 's');
        
        // Use config to format table names properly
        const targetTable = this.config.formatTableName(this.tableName, true);
        const sourceTable = this.config.formatTableName(sourceTableName);
        
        return `
            INSERT INTO ${targetTable} (registry, pkg_name, tag_name, top_hash)
            SELECT DISTINCT
              ${selectClause}
            FROM ${sourceTable} s
            LEFT JOIN ${targetTable} t
              ON s.pkg_name = t.pkg_name
              AND s.timestamp = t.tag_name
              AND t.registry = '${context.registryName}'
            WHERE s.timestamp = 'latest'
              AND (t.top_hash IS NULL OR s.top_hash != t.top_hash)`;
    }
}
