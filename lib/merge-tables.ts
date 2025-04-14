import { Context } from 'aws-lambda';
import { GlueClient, GetTablesCommand, GetTableCommand } from '@aws-sdk/client-glue';
import { AthenaClient, StartQueryExecutionCommand } from '@aws-sdk/client-athena';

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

  // Filter for S3-backed tables
  const s3Tables = tablesResponse.TableList?.filter(table => 
    table.StorageDescriptor?.Location?.startsWith('s3://')
  ) || [];

  // Create CTAS query to merge tables
  const tableQueries = s3Tables.map(table => `SELECT * FROM ${databaseName}.${table.Name}`);
  const unionQuery = tableQueries.join(' UNION ALL ');
  
  const createTableQuery = `
    CREATE TABLE ${databaseName}.titanic_merged
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
    FROM (${unionQuery})
  `;

    // Execute the query
    const queryResponse = await athenaClient.send(new StartQueryExecutionCommand({
      QueryString: createTableQuery,
      ResultConfiguration: {
        OutputLocation: `s3://${targetBucket}/athena-results/`
      }
    }));

    return {
      queryExecutionId: queryResponse.QueryExecutionId,
      message: 'Merge query started successfully',
      numTables: s3Tables.length
    };
  } catch (error) {
    console.error('Error merging tables:', error);
    throw error;
  }
}
