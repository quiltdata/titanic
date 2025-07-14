import { BaseTable } from "./base-table";
import { ColumnDefinitions } from "../shared/types";

export class PackageRevisionTable extends BaseTable {
    public get tableName(): string {
        return "package_revision";
    }

    protected getColumnDefinitions(): ColumnDefinitions {
        return {
            'registry': 'VARCHAR',
            'pkg_name': 'VARCHAR',
            'top_hash': 'VARCHAR',
            'timestamp': 'TIMESTAMP',
            'message': 'VARCHAR',
            'metadata': 'VARCHAR'
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

    public generateInsertQuery(packagesView: string, _objectsView: string): string {
        // Extract registry name from the packages view table name
        const registryName = this.extractRegistryName(packagesView);
        const selectClause = this.generateSelectClause(registryName, 's');
        
        // Target table is SQL safe and unquoted, source table needs quoting
        const targetTable = this.tableName;
        const sourceTable = `"${packagesView}"`;
        
        return `
            INSERT INTO ${targetTable} (registry, pkg_name, top_hash, timestamp, message, metadata)
            SELECT DISTINCT
              ${selectClause}
            FROM ${sourceTable} s
            LEFT JOIN ${targetTable} t
              ON s.pkg_name = t.pkg_name
              AND s.top_hash = t.top_hash
              AND t.registry = '${registryName}'
            WHERE t.pkg_name IS NULL
              AND s.timestamp != 'latest'`;
    }

    private extractRegistryName(tableName: string): string {
        // Extract registry name from table name like "npm_packages-view" 
        // or "AwsDataCatalog"."userathenadatabase-6fosfzznfasm"."quilt-bake_packages-view"
        
        // First remove quotes and database/catalog prefixes if present
        const cleanTableName = tableName.replace(/^".*"\.".*"\."|^".*"\.|"$/g, '');
        
        // Then extract the registry name from the clean table name
        const match = cleanTableName.match(/^(.+?)_packages-view$/);
        return match ? match[1] : 'unknown';
    }
}
