import { BaseTable } from "./base-table";
import { ColumnDefinitions } from "../shared/types";

export class PackageTagTable extends BaseTable {
    public get tableName(): string {
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
        return `PARTITIONED BY (registry, tag_name, bucket(8, pkg_name))`;
    }

    protected generateSelectClause(registryName: string, sourceAlias: string): string {
        return `'${registryName}' AS registry, ${sourceAlias}.pkg_name, ${sourceAlias}.timestamp AS tag_name, ${sourceAlias}.top_hash`;
    }

    protected generateWhereClauseForCtas(sourceAlias: string): string {
        return `${sourceAlias}.timestamp = 'latest'`;
    }

    public generateInsertQuery(packagesView: string, _objectsView: string): string {
        // Extract registry name from the packages view table name
        const registryName = this.extractRegistryName(packagesView);
        const selectClause = this.generateSelectClause(registryName, 's');
        
        // Target table uses fully-qualified name for S3 Tables, simple name for Glue
        const targetTable = this.getTargetTableName();
        const sourceTable = `"${packagesView}"`;
        
        return `
            INSERT INTO ${targetTable} (registry, pkg_name, tag_name, top_hash)
            SELECT DISTINCT
              ${selectClause}
            FROM ${sourceTable} s
            LEFT JOIN ${targetTable} t
              ON s.pkg_name = t.pkg_name
              AND s.timestamp = t.tag_name
              AND t.registry = '${registryName}'
            WHERE s.timestamp = 'latest'
              AND (t.top_hash IS NULL OR s.top_hash != t.top_hash)`;
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
