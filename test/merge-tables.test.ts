import { Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { GlueClient, GetTablesCommand } from '@aws-sdk/client-glue';
import { AthenaClient, StartQueryExecutionCommand } from '@aws-sdk/client-athena';
import { handler } from '../lib/merge-tables';

const glueMock = mockClient(GlueClient);
const athenaMock = mockClient(AthenaClient);

describe('merge-tables lambda', () => {
  beforeEach(() => {
    process.env.DATABASE_NAME = 'test-db';
    process.env.TARGET_BUCKET = 'test-bucket';
    glueMock.reset();
    athenaMock.reset();
  });

  it('should throw error if environment variables are missing', async () => {
    delete process.env.DATABASE_NAME;
    await expect(handler({}, {} as Context)).rejects.toThrow(
      'Missing required environment variables'
    );
  });

  it('should throw error if no tables found', async () => {
    glueMock.on(GetTablesCommand).resolves({
      TableList: []
    });

    await expect(handler({}, {} as Context)).rejects.toThrow(
      'No tables found in database'
    );
  });

  it('should successfully merge S3-backed tables', async () => {
    glueMock.on(GetTablesCommand).resolves({
      TableList: [
        {
          Name: 'packages_all',
          StorageDescriptor: { Location: 's3://bucket/packages_all' }
        },
        {
          Name: 'objects_all',
          StorageDescriptor: { Location: 's3://bucket/objects_all' }
        }
      ]
    });

    athenaMock.on(StartQueryExecutionCommand).resolves({
      QueryExecutionId: 'test-execution-id'
    });

    const result = await handler({}, {} as Context);

    expect(result).toEqual({
      message: 'Merge queries started successfully',
      numTables: 2
    });
  });

  it('should filter tables by DEBUG_BUCKET when set', async () => {
    process.env.DEBUG_BUCKET = 'quilt-bake';
    glueMock.on(GetTablesCommand).resolves({
      TableList: [
        {
          Name: 'quilt-bake-table',
          StorageDescriptor: { Location: 's3://bucket/table1' }
        },
        {
          Name: 'other-table',
          StorageDescriptor: { Location: 's3://bucket/table2' }
        }
      ]
    });

    const result = await handler({}, {} as Context);
    expect(result.numTables).toBe(1);
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

    // Mock Athena error
    athenaMock.on(StartQueryExecutionCommand).rejects(new Error('Athena error'));

    // Test that the Athena error is propagated
    await expect(handler({}, {} as Context)).rejects.toThrow('Athena error');
  });
});
