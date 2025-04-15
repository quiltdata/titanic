import { Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import * as https from 'https';

// Mock https.request
jest.mock('https', () => {
  const originalModule = jest.requireActual('https');
  return {
    ...originalModule,
    request: jest.fn().mockImplementation((options, callback) => ({
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    }))
  };
});

jest.setTimeout(30000); // Increase timeout to 30 seconds
import { GlueClient, GetTablesCommand } from '@aws-sdk/client-glue';
import { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, QueryExecutionState } from '@aws-sdk/client-athena';
import { handler } from '../lib/merge-tables';

const glueMock = mockClient(GlueClient);
const athenaMock = mockClient(AthenaClient);

describe('merge-tables lambda', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_NAME = 'test-db';
    process.env.TARGET_BUCKET = 'test-bucket';
    process.env.LAMBDA_TIMEOUT = '5000';
    glueMock.reset();
    athenaMock.reset();
  });

  it('should throw error if environment variables are missing', async () => {
    delete process.env.DATABASE_NAME;
    const mockEvent = {
      RequestType: 'Create' as const,
      ResponseURL: 'https://test.com',
      StackId: 'test-stack',
      RequestId: 'test-request',
      LogicalResourceId: 'test-resource'
    };
    await expect(handler(mockEvent, {} as Context)).rejects.toThrow(
      'Missing required environment variables'
    );
  });

  it('should handle empty table list gracefully', async () => {
    glueMock.on(GetTablesCommand).resolves({
      TableList: []
    });

    athenaMock.on(StartQueryExecutionCommand).resolves({
      QueryExecutionId: 'test-query-id'
    });

    athenaMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Status: {
          State: QueryExecutionState.SUCCEEDED
        }
      }
    });

    athenaMock.on(StartQueryExecutionCommand).resolves({
      QueryExecutionId: 'test-query-id'
    });

    athenaMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Status: {
          State: QueryExecutionState.SUCCEEDED
        }
      }
    });

    const mockEvent = {
      RequestType: 'Create' as const,
      ResponseURL: 'https://test.com',
      StackId: 'test-stack',
      RequestId: 'test-request',
      LogicalResourceId: 'test-resource'
    };
    const result = await handler(mockEvent, {} as Context);
    expect(result).toEqual({
      message: 'Created merged table (no source tables found)',
      numTables: 0
    });
  });

  it('should successfully merge S3-backed tables', async () => {
    glueMock.on(GetTablesCommand).resolves({
      TableList: [
        {
          Name: 'packages_all_quilt-bake',
          StorageDescriptor: { Location: 's3://bucket/packages_all' }
        },
        {
          Name: 'objects_all_quilt-bake',
          StorageDescriptor: { Location: 's3://bucket/objects_all' }
        }
      ]
    });

    athenaMock.on(StartQueryExecutionCommand).resolves({
      QueryExecutionId: 'test-execution-id'
    });

    athenaMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Status: {
          State: QueryExecutionState.SUCCEEDED
        }
      }
    });

    const mockEvent = {
      RequestType: 'Create' as const,
      ResponseURL: 'https://test.com',
      StackId: 'test-stack',
      RequestId: 'test-request',
      LogicalResourceId: 'test-resource'
    };
    const result = await handler(mockEvent, {} as Context);

    expect(result).toEqual({
      message: 'Merge queries started successfully',
      numTables: 2
    });
  });


  it('should handle CloudFormation DELETE events', async () => {
    const event = {
      RequestType: 'Delete' as const,
      ResponseURL: 'https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com/',
      StackId: 'test-stack',
      RequestId: 'test-request',
      LogicalResourceId: 'TestResource'
    };

    const result = await handler(event, {} as Context);
    expect(result).toBeUndefined();
  });

  it('should respect custom timeout configuration', async () => {
    process.env.LAMBDA_TIMEOUT = '10000';
    
    glueMock.on(GetTablesCommand).resolves({
      TableList: []
    });

    athenaMock.on(StartQueryExecutionCommand).resolves({
      QueryExecutionId: 'test-query-id'
    });

    athenaMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Status: {
          State: QueryExecutionState.SUCCEEDED
        }
      }
    });

    const mockEvent = {
      RequestType: 'Create' as const,
      ResponseURL: 'https://test.com',
      StackId: 'test-stack',
      RequestId: 'test-request',
      LogicalResourceId: 'test-resource'
    };
    const result = await handler(mockEvent, {} as Context);
    expect(result).toBeDefined();
  });

  it('should handle Athena query failures', async () => {
    // Mock tables response
    glueMock.on(GetTablesCommand).resolves({
      TableList: [
        {
          Name: 'table1',
          StorageDescriptor: { Location: 's3://bucket/table1' }
        }
      ]
    });

    // Mock Athena responses
    athenaMock.on(StartQueryExecutionCommand).resolves({
      QueryExecutionId: 'test-execution-id'
    });

    // First mock the create table query success
    athenaMock.on(GetQueryExecutionCommand)
      .resolvesOnce({
        QueryExecution: {
          Status: {
            State: QueryExecutionState.SUCCEEDED
          }
        }
      })
      // Then mock the merge query failure
      .resolves({
        QueryExecution: {
          Status: {
            State: QueryExecutionState.FAILED,
            StateChangeReason: 'Athena error'
          }
        }
      });
    
    athenaMock.on(GetQueryExecutionCommand).resolves({
      QueryExecution: {
        Status: {
          State: QueryExecutionState.FAILED,
          StateChangeReason: 'Athena error'
        }
      }
    });

    // Test that the Athena error is propagated
    const mockEvent = {
      RequestType: 'Create' as const,
      ResponseURL: 'https://test.com',
      StackId: 'test-stack',
      RequestId: 'test-request',
      LogicalResourceId: 'test-resource'
    };
    await expect(handler(mockEvent, {} as Context)).rejects.toThrow('Athena error');
  });
});
