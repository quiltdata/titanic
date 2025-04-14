import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

export interface TitanicStackProps extends cdk.StackProps {
  quiltDatabaseName: string;
}

export class TitanicStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TitanicStackProps) {
    super(scope, id, props);

    // Create the Titanic bucket
    const titanicBucket = new s3.Bucket(this, 'TitanicBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Create merge tables Lambda
    const mergeLambda = new lambda.NodejsFunction(this, 'MergeTables', {
      entry: path.join(__dirname, 'merge-tables.ts'),
      handler: 'handler',
      environment: {
        DATABASE_NAME: props.quiltDatabaseName,
        TARGET_BUCKET: titanicBucket.bucketName,
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
      actions: ['athena:StartQueryExecution'],
      resources: [`arn:aws:athena:${this.region}:${this.account}:workgroup/primary`]
    }));

    titanicBucket.grantReadWrite(mergeLambda);

    // Create Glue table for Athena
    new glue.CfnTable(this, 'MergedTable', {
      databaseName: 'default',
      catalogId: this.account,
      tableInput: {
        name: 'titanic_merged',
        storageDescriptor: {
          location: `s3://${titanicBucket.bucketName}/merged/`,
          inputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          },
          columns: [
            // Add your columns here based on the schema of your merged data
            // Example:
            // { name: 'column_name', type: 'string' },
          ],
        },
      },
    });
  }
}
