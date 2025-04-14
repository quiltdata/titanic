import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { TitanicStack } from '../lib/titanic-stack';

describe('TitanicStack', () => {
  const app = new cdk.App();
  const stack = new TitanicStack(app, 'TestStack', {
    quiltDatabaseName: 'test-database'
  });
  const template = Template.fromStack(stack);

  it('creates an S3 bucket', () => {
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'Delete',
      UpdateReplacePolicy: 'Delete'
    });
  });

  it('creates a Lambda function', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          DATABASE_NAME: 'test-database'
        }
      }
    });
  });

  it('creates required IAM policies', () => {
    const policyProps = template.findResources('AWS::IAM::Policy');
    const policy = Object.values(policyProps)[0];
    
    expect(policy.Properties.PolicyDocument).toEqual({
      Version: '2012-10-17',
      Statement: expect.arrayContaining([
        expect.objectContaining({
          Effect: 'Allow',
          Action: ['glue:GetTables', 'glue:GetTable'],
          Resource: expect.any(Array)
        })
      ])
    });
  });

  it('should pass DEBUG_BUCKET to Lambda when provided', () => {
    const debugApp = new cdk.App();
    const debugStack = new TitanicStack(debugApp, 'DebugStack', {
      quiltDatabaseName: 'test-database',
      debugBucket: 'quilt-bake'
    });
    const debugTemplate = Template.fromStack(debugStack);

    debugTemplate.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          DATABASE_NAME: 'test-database',
          DEBUG_BUCKET: 'quilt-bake'
        }
      }
    });
  });

  it('creates Glue table', () => {
    template.hasResourceProperties('AWS::Glue::Table', {
      DatabaseName: 'test-database',
      CatalogId: {
        Ref: 'AWS::AccountId'
      },
      TableInput: {
        Name: 'titanic_merged_table',
        StorageDescriptor: {
          Location: {
            'Fn::Join': [
              '',
              [
                's3://',
                {
                  Ref: 'TitanicBucketBD9D9364'
                },
                '/merged/'
              ]
            ]
          },
          InputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          OutputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          SerdeInfo: {
            SerializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe'
          },
          Columns: [
            { Name: 'pkg_name', Type: 'string' },
            { Name: 'top_hash', Type: 'string' },
            { Name: 'timestamp', Type: 'string' },
            { Name: 'message', Type: 'string' },
            { Name: 'user_meta', Type: 'string' },
            { Name: 'source_bucket', Type: 'string' }
          ]
        },
        PartitionKeys: [
          { Name: 'source_bucket', Type: 'string' }
        ]
      }
    });
  });
});
