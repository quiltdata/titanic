import { tableExists, executeQuery, athenaClient, waitForQueryCompletion } from "../shared/athena-utils";
import { StartQueryExecutionCommand } from "@aws-sdk/client-athena";
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

        console.log(`Creating ${this.TABLE_NAME} table using CTAS from`, sourceView);
        const schema = `
            WITH (
                format = 'PARQUET',
                write_compression = 'SNAPPY',
                location = 's3://${targetBucket}/${this.TABLE_NAME}/',
                table_type = 'ICEBERG',
                is_external = false
            )
            PARTITIONED BY (
                registry,
                tag_name,
                bucket(8, pkg_name)
            )`;

        await this.createTableWithCTAS(databaseName, sourceView, schema, targetBucket);
    }

    private static async createTableWithCTAS(
        databaseName: string,
        sourceView: string,
        schema: string,
        targetBucket: string
    ): Promise<void> {
        const ctasQuery = `
            CREATE TABLE IF NOT EXISTS "${databaseName}"."${this.TABLE_NAME}"
            ${schema}
            AS SELECT * FROM "${databaseName}"."${sourceView}" WHERE false
        `;

        const response = await athenaClient.send(
            new StartQueryExecutionCommand({
                QueryString: ctasQuery,
                ResultConfiguration: {
                    OutputLocation: `s3://${targetBucket}/athena-results/`,
                },
            })
        );

        if (!response.QueryExecutionId) {
            throw new Error(`Failed to get QueryExecutionId for CTAS for ${this.TABLE_NAME}`);
        }

        await waitForQueryCompletion(response.QueryExecutionId);
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
