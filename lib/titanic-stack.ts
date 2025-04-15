import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';

export interface TitanicStackProps extends cdk.StackProps {
  quiltDatabaseName: string;
  lambdaTimeout?: number;
}

export class TitanicStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TitanicStackProps) {
    super(scope, id, props);

    // Create the Titanic bucket
    const titanicBucket = new s3.Bucket(this, 'TitanicBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Create SQS queue
    const mergeQueue = new sqs.Queue(this, 'MergeQueue', {
      visibilityTimeout: cdk.Duration.seconds(900),
      retentionPeriod: cdk.Duration.days(14)
    });

    // Create merge tables Lambda
    const mergeLambda = new lambda.NodejsFunction(this, 'MergeTables', {
      events: [
        new SqsEventSource(mergeQueue, {
          batchSize: 1
        })
      ],
      entry: path.join(__dirname, 'merge-tables.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_18_X,
      timeout: cdk.Duration.seconds(900),
      bundling: {
        externalModules: [
          '@aws-sdk/client-glue',
          '@aws-sdk/client-athena'
        ]
      },
      environment: {
        DATABASE_NAME: props.quiltDatabaseName,
        TARGET_BUCKET: titanicBucket.bucketName,
        LAMBDA_TIMEOUT: (props.lambdaTimeout || 5000).toString(),
        QUEUE_URL: mergeQueue.queueUrl
      },
    });

    // Grant Lambda permissions
    mergeLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['glue:GetTables', 'glue:GetTable'],
      resources: [`arn:aws:glue:${this.region}:${this.account}:catalog`, 
                 `arn:aws:glue:${this.region}:${this.account}:database/${props.quiltDatabaseName}`,
                 `arn:aws:glue:${this.region}:${this.account}:table/${props.quiltDatabaseName}/*`]
    }));

    mergeLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['athena:StartQueryExecution', 'athena:GetQueryExecution'],
      resources: [`arn:aws:athena:${this.region}:${this.account}:workgroup/primary`]
    }));

    titanicBucket.grantReadWrite(mergeLambda);
    mergeQueue.grantConsumeMessages(mergeLambda);

    // Create Glue table for Athena
    new glue.CfnTable(this, 'MergedTable', {
      databaseName: props.quiltDatabaseName,
      catalogId: this.account,
      tableInput: {
        name: 'titanic_merged_table',
        storageDescriptor: {
          location: `s3://${titanicBucket.bucketName}/merged/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          columns: [
            { name: 'pkg_name', type: 'string' },
            { name: 'top_hash', type: 'string' },
            { name: 'timestamp', type: 'string' },
            { name: 'message', type: 'string' },
            { name: 'user_meta', type: 'string' }
          ],
        },
        partitionKeys: [
          { name: 'source_bucket', type: 'string' }
        ]
      },
    });

    // Create Glue table for packages_all
    new glue.CfnTable(this, 'PackagesAllTable', {
      databaseName: props.quiltDatabaseName,
      catalogId: this.account,
      tableInput: {
        name: 'packages_all',
        storageDescriptor: {
          location: `s3://${titanicBucket.bucketName}/packages_all/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          columns: [
            { name: 'pkg_name', type: 'string' },
            { name: 'top_hash', type: 'string' },
            { name: 'timestamp', type: 'string' },
            { name: 'message', type: 'string' },
            { name: 'user_meta', type: 'string' }
          ],
        },
      },
    });

    // Create Glue table for objects_all
    new glue.CfnTable(this, 'ObjectsAllTable', {
      databaseName: props.quiltDatabaseName,
      catalogId: this.account,
      tableInput: {
        name: 'objects_all',
        storageDescriptor: {
          location: `s3://${titanicBucket.bucketName}/objects_all/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          columns: [
            { name: 'pkg_name', type: 'string' },
            { name: 'top_hash', type: 'string' },
            { name: 'timestamp', type: 'string' },
            { name: 'logical_key', type: 'string' },
            { name: 'physical_key', type: 'string' },
            { name: 'size', type: 'bigint' },
            { name: 'hash', type: 'struct<type:string,value:string>' },
            { name: 'meta', type: 'string' },
            { name: 'source_bucket', type: 'string' }
          ],
        },
        partitionKeys: [
          { name: 'source_bucket', type: 'string' }
        ]
      },
    });

  }
}
