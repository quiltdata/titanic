import { BaseTable } from "./base-table";
import { TableContext, ColumnDefinitions } from "../shared/types";

export class PackageRevisionTable extends BaseTable {
    protected get tableName(): string {
        return "package_revision";
    }

    protected getColumnDefinitions(): ColumnDefinitions {
        return {
            'registry': 'STRING',
            'pkg_name': 'STRING',
            'top_hash': 'STRING',
            'timestamp': 'TIMESTAMP',
            'message': 'STRING',
            'metadata': 'STRING'
        };
    }

    protected getPartitioningClause(): string {
        return `PARTITIONED BY (
              registry,
              bucket(8, pkg_name),
              bucket(8, top_hash)
            )`;
    }

    protected generateSelectClause(registryName: string, sourceAlias: string): string {
        return `'${registryName}' AS registry,
              ${sourceAlias}.pkg_name,
              ${sourceAlias}.top_hash,
              from_unixtime(CAST(${sourceAlias}.timestamp AS bigint)) AS timestamp,
              ${sourceAlias}.message,
              ${sourceAlias}.user_meta AS metadata`;
    }

    protected generateWhereClauseForCtas(sourceAlias: string): string {
        return `${sourceAlias}.timestamp != 'latest'`;
    }

    public generateInsertQuery(context: TableContext, sourceTableName: string): string {
        const selectClause = this.generateSelectClause(context.registryName, 's');
        
        // Target table is SQL safe and unquoted, source table needs quoting
        const targetTable = this.tableName;
        const sourceTable = `"${sourceTableName}"`;
        
        return `
            INSERT INTO ${targetTable} (registry, pkg_name, top_hash, timestamp, message, metadata)
            SELECT DISTINCT
              ${selectClause}
            FROM ${sourceTable} s
            LEFT JOIN ${targetTable} t
              ON s.pkg_name = t.pkg_name
              AND s.top_hash = t.top_hash
              AND t.registry = '${context.registryName}'
            WHERE t.pkg_name IS NULL
              AND s.timestamp != 'latest'`;
    }
}
