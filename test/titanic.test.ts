import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { TitanicStack } from '../lib/titanic-stack';

describe('TitanicStack', () => {
  const app = new cdk.App();
  const stack = new TitanicStack(app, 'MyTestStack', {
    quiltDatabaseName: 'test-database'
  });
  const template = Template.fromStack(stack);

  test('creates SQS queue with correct settings', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 900,
      MessageRetentionPeriod: 1209600 // 14 days in seconds
    });
  });

  test('creates Lambda function with SQS trigger', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          DATABASE_NAME: 'test-database',
          LAMBDA_TIMEOUT: '5000'
        }
      }
    });

    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      BatchSize: 1,
      EventSourceArn: {
        'Fn::GetAtt': [
          Object.keys(template.findResources('AWS::SQS::Queue'))[0],
          'Arn'
        ]
      }
    });
  });
});
