import { BaseTable } from "./base-table";
import { ColumnDefinitions } from "../shared/types";

export class PackageEntryTable extends BaseTable {
    public get tableName(): string {
        return "package_entry";
    }

    protected getColumnDefinitions(): ColumnDefinitions {
        return {
            'registry': 'VARCHAR',
            'top_hash': 'VARCHAR',
            'logical_key': 'VARCHAR',
            'physical_key': 'VARCHAR',
            'multihash': 'VARCHAR',
            'size': 'BIGINT',
            'metadata': 'VARCHAR'
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

    protected generateWhereClauseForCtas(_sourceAlias: string): string {
        // No additional WHERE clause needed for CTAS in package entries
        return '';
    }

    public generateInsertQuery(packagesView: string, objectsView: string): string {
        // Extract registry name from the objects view table name
        const registryName = this.extractRegistryName(objectsView);
        const selectClause = this.generateSelectClause(registryName, 's');
        
        // Target table is SQL safe and unquoted, source table needs quoting
        const targetTable = this.tableName;
        const sourceTable = `"${objectsView}"`;
        
        return `
            INSERT INTO ${targetTable} (registry, top_hash, logical_key, physical_key, multihash, size, metadata)
            SELECT DISTINCT
              ${selectClause}
            FROM ${sourceTable} s
            LEFT JOIN ${targetTable} t
              ON s.logical_key = t.logical_key
              AND s.meta = t.metadata
              AND s.top_hash = t.top_hash
              AND t.registry = '${registryName}'
            WHERE t.logical_key IS NULL`;
    }

    private extractRegistryName(tableName: string): string {
        // Extract registry name from table name like "npm_objects-view"
        // or "AwsDataCatalog"."userathenadatabase-6fosfzznfasm"."quilt-bake_objects-view"
        
        // First remove quotes and database/catalog prefixes if present
        const cleanTableName = tableName.replace(/^".*"\.".*"\."|^".*"\.|"$/g, '');
        
        // Then extract the registry name from the clean table name
        const match = cleanTableName.match(/^(.+?)_objects-view$/);
        return match ? match[1] : 'unknown';
    }
}
