import { Context } from 'aws-lambda';
import { GlueClient } from '@aws-sdk/client-glue';
import { GetTablesCommand, GetTableCommand } from '@aws-sdk/client-glue';
import { AthenaClient } from '@aws-sdk/client-athena';
import { StartQueryExecutionCommand } from '@aws-sdk/client-athena';

const glueClient = new GlueClient({});
const athenaClient = new AthenaClient({});

export async function handler(event: any, context: Context) {
  const databaseName = process.env.DATABASE_NAME;
  const targetBucket = process.env.TARGET_BUCKET;

  if (!databaseName || !targetBucket) {
    throw new Error('Missing required environment variables DATABASE_NAME or TARGET_BUCKET');
  }

  try {
    // Get all tables in the database
    const tablesResponse = await glueClient.send(new GetTablesCommand({
      DatabaseName: databaseName,
    }));

    if (!tablesResponse.TableList || tablesResponse.TableList.length === 0) {
      throw new Error(`No tables found in database ${databaseName}`);
    }

    // Filter for source tables (excluding the merged table)
    const sourceTables = tablesResponse.TableList?.filter(table => {
      if (!table.Name) return false;
      
      const isSourceTable = table.Name !== 'titanic_merged' && 
                          table.StorageDescriptor?.Location?.startsWith('s3://');
      
      // If DEBUG_BUCKET is set, only include tables from that source bucket
      if (process.env.DEBUG_BUCKET) {
        return isSourceTable && table.Name.includes(process.env.DEBUG_BUCKET);
      }
      
      return isSourceTable;
    }) || [];

    // First check if merged table exists
    const createIfNotExistsQuery = `
      CREATE TABLE IF NOT EXISTS ${databaseName}.titanic_merged
      WITH (
        external_location = 's3://${targetBucket}/merged/',
        format = 'PARQUET',
        partitioned_by = ARRAY['source_bucket']
      )
      AS 
      SELECT 
        pkg_name,
        top_hash,
        timestamp,
        message,
        user_meta,
        source_bucket
      FROM ${databaseName}.${sourceTables[0].Name}
      WHERE 1=0
    `;

    await athenaClient.send(new StartQueryExecutionCommand({
      QueryString: createIfNotExistsQuery,
      ResultConfiguration: {
        OutputLocation: `s3://${targetBucket}/athena-results/`
      }
    }));

    // Build MERGE query for each source table
    const mergeQueries = sourceTables.map(table => `
      INSERT INTO ${databaseName}.titanic_merged
      SELECT DISTINCT
        s.pkg_name,
        s.top_hash,
        s.timestamp,
        s.message,
        s.user_meta,
        s.source_bucket
      FROM ${databaseName}.${table.Name} s
      LEFT JOIN ${databaseName}.titanic_merged t
      ON s.pkg_name = t.pkg_name 
      AND s.top_hash = t.top_hash
      AND s.source_bucket = t.source_bucket
      WHERE t.pkg_name IS NULL
    `);

    // Execute each merge query sequentially
    for (const query of mergeQueries) {
      const queryResponse = await athenaClient.send(new StartQueryExecutionCommand({
        QueryString: query,
        ResultConfiguration: {
          OutputLocation: `s3://${targetBucket}/athena-results/`
        }
      }));
      
      // In production, you might want to wait for each query to complete
      // before starting the next one
    }

    return {
      message: 'Merge queries started successfully',
      numTables: sourceTables.length
    };
  } catch (error) {
    console.error('Error merging tables:', error);
    throw error;
  }
}
