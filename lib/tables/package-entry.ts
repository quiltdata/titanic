import { BaseTable } from "./base-table";
import { TableContext, ColumnDefinitions } from "../shared/types";

export class PackageEntryTable extends BaseTable {
    protected get tableName(): string {
        return "package_entry";
    }

    protected getColumnDefinitions(): ColumnDefinitions {
        return {
            'registry': 'STRING',
            'top_hash': 'STRING',
            'logical_key': 'STRING',
            'physical_key': 'STRING',
            'multihash': 'STRING',
            'size': 'BIGINT',
            'metadata': 'STRING'
        };
    }

    protected getPartitioningClause(): string {
        return `PARTITIONED BY (
              registry,
              bucket(64, physical_key)
            )`;
    }

    protected generateSelectClause(registryName: string, sourceAlias: string): string {
        return `'${registryName}' AS registry,
              ${sourceAlias}.top_hash,
              ${sourceAlias}.logical_key,
              ${sourceAlias}.physical_key,
              concat(
                CASE ${sourceAlias}.hash.type
                  WHEN 'SHA256' THEN '1220'
                  WHEN 'sha2-256-chunked' THEN 'b150'
                  ELSE '0000'
                END,
                ${sourceAlias}.hash.value
              ) AS multihash,
              ${sourceAlias}.size,
              ${sourceAlias}.meta AS metadata`;
    }

    protected generateWhereClauseForCtas(sourceAlias: string): string {
        // No additional WHERE clause needed for CTAS in package entries
        return '';
    }

    protected generateInsertQuery(context: TableContext, sourceTableName: string): string {
        const selectClause = this.generateSelectClause(context.registryName, 's');
        
        // Use config to format table names properly
        const targetTable = this.config.formatTableName(this.tableName, true);
        const sourceTable = this.config.formatTableName(sourceTableName);
        
        return `
            INSERT INTO ${targetTable} (registry, top_hash, logical_key, physical_key, multihash, size, metadata)
            SELECT DISTINCT
              ${selectClause}
            FROM ${sourceTable} s
            LEFT JOIN ${targetTable} t
              ON s.logical_key = t.logical_key
              AND s.meta = t.metadata
              AND s.top_hash = t.top_hash
              AND t.registry = '${context.registryName}'
            WHERE t.logical_key IS NULL`;
    }
}
