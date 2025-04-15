import { Context } from 'aws-lambda';
import { GlueClient } from '@aws-sdk/client-glue';
import { GetTablesCommand, GetTableCommand } from '@aws-sdk/client-glue';
import { AthenaClient } from '@aws-sdk/client-athena';
import { 
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  QueryExecutionState
} from '@aws-sdk/client-athena';

const glueClient = new GlueClient({
  maxAttempts: 3
});
const athenaClient = new AthenaClient({
  maxAttempts: 3
});


async function waitForQueryCompletion(queryExecutionId: string, maxAttempts: number = 30): Promise<void> {
  let attempts = 0;
  while (true) {
    const queryExecution = await athenaClient.send(new GetQueryExecutionCommand({
      QueryExecutionId: queryExecutionId
    }));
    
    const state = queryExecution.QueryExecution?.Status?.State;
    
    if (state === QueryExecutionState.SUCCEEDED) {
      return;
    }
    
    if (state === QueryExecutionState.FAILED || 
        state === QueryExecutionState.CANCELLED) {
      throw new Error(`Query failed: ${queryExecution.QueryExecution?.Status?.StateChangeReason}`);
    }
    
    attempts++;
    if (attempts >= maxAttempts) {
      throw new Error(`Query timed out after ${maxAttempts} attempts`);
    }
    // Wait 2 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

type HandlerResponse = {
  message: string;
  numTables: number;
} | undefined;

export async function handler(event: Record<string, any>, context: Context): Promise<HandlerResponse> {
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

    if (!tablesResponse.TableList) {
      throw new Error(`Unable to list tables in database ${databaseName}`);
    }

    // Get table_prefix from SQS message if present
    const messageBody = event.Records?.[0]?.body;
    let tablePrefix: string | undefined;
    try {
      if (messageBody) {
        const parsedBody = JSON.parse(messageBody) as { table_prefix?: string };
        tablePrefix = parsedBody.table_prefix;
      }
    } catch (e) {
      console.warn('Failed to parse message body:', e);
    }

    // Filter for source tables (excluding the merged table)
    const sourceTables = tablesResponse.TableList?.filter(table => {
      if (!table.Name) return false;
        
      // Check if table name starts with our source table prefixes
      const isPackagesTable = table.Name.startsWith('packages_all');
      const isObjectsTable = table.Name.startsWith('objects_all');
        
      // If tablePrefix is specified, only include matching tables
      if (tablePrefix) {
        return (isPackagesTable || isObjectsTable) && table.Name.includes(tablePrefix);
      }
        
      return isPackagesTable || isObjectsTable;
    }) || [];

    // First check if merged table exists
    const createIfNotExistsQuery = `
      CREATE TABLE IF NOT EXISTS "${databaseName}"."titanic_merged_table"
      WITH (
        external_location = 's3://${targetBucket}/merged/',
        format = 'PARQUET',
        partitioned_by = ARRAY['source_bucket']
      )
      AS 
      SELECT 
        "pkg_name",
        "top_hash",
        "timestamp",
        "message",
        "user_meta",
        "source_bucket"
      FROM "${databaseName}"."${sourceTables.length > 0 ? sourceTables[0].Name : 'packages_all'}"
      WHERE 1=0
    `;

    const createTableResponse = await athenaClient.send(new StartQueryExecutionCommand({
      QueryString: createIfNotExistsQuery,
      ResultConfiguration: {
        OutputLocation: `s3://${targetBucket}/athena-results/`
      }
    }));
    
    if (!createTableResponse.QueryExecutionId) {
      throw new Error('Failed to get QueryExecutionId for create table query');
    }
    
    await waitForQueryCompletion(createTableResponse.QueryExecutionId);

    // Build MERGE query for each source table
    const mergeQueries = sourceTables.map(table => `
      INSERT INTO "${databaseName}"."titanic_merged_table"
      SELECT DISTINCT
        s."pkg_name",
        s."top_hash",
        s."timestamp",
        s."message",
        s."user_meta",
        s."source_bucket"
      FROM "${databaseName}"."${table.Name}" s
      LEFT JOIN "${databaseName}"."titanic_merged_table" t
      ON s."pkg_name" = t."pkg_name" 
      AND s."top_hash" = t."top_hash"
      AND s."source_bucket" = t."source_bucket"
      WHERE t."pkg_name" IS NULL
    `);

    if (sourceTables.length > 0) {
      // Execute each merge query sequentially
      for (const query of mergeQueries) {
        const queryResponse = await athenaClient.send(new StartQueryExecutionCommand({
          QueryString: query,
          ResultConfiguration: {
            OutputLocation: `s3://${targetBucket}/athena-results/`
          }
        }));
        
        if (!queryResponse.QueryExecutionId) {
          throw new Error('Failed to get QueryExecutionId for merge query');
        }
        
        await waitForQueryCompletion(queryResponse.QueryExecutionId);
      }
    }

    const response = {
      message: sourceTables.length > 0 ? 'Merge queries started successfully' : 'Created merged table (no source tables found)',
      numTables: sourceTables.length
    };

    return response;
  } catch (error) {
    const err = error as Error;
    console.error('Error merging tables:', {
      error: err.message,
      stack: err.stack,
      databaseName,
      targetBucket
    });
    throw err;
  }
}
