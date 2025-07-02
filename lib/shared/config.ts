/**
 * Centralized configuration management for the Titanic project.
 * Defaults to Glue configuration with S3Config subclass for S3 tables.
 */
export class Config {
  public readonly aws_region: string;
  public readonly glueDatabaseName: string;
  public readonly glueTablesBucket: string;
  public readonly s3TableDatabaseName: string;
  public readonly s3TablesBucket: string;
  public readonly useS3Table: boolean;

  constructor(config?: Partial<Config>) {
    this.aws_region = config?.aws_region ?? (process.env.AWS_REGION || 'us-east-1');
    this.glueDatabaseName = config?.glueDatabaseName ?? (process.env.GLUE_DATABASE_NAME || 'glue_database');
    this.glueTablesBucket = config?.glueTablesBucket ?? (process.env.GLUE_TABLES_BUCKET || '');
    this.s3TableDatabaseName = config?.s3TableDatabaseName ?? (process.env.S3TABLE_DATABASE_NAME || 's3_table_database');
    this.s3TablesBucket = config?.s3TablesBucket ?? (process.env.S3_TABLES_BUCKET || '');
    this.useS3Table = config?.useS3Table ?? false;
  }
  
  // Factory method to create appropriate config type based on environment
  public static create(config?: Partial<Config>): Config {
    return process.env.USE_S3_TABLE === 'true' 
      ? new S3Config(config) 
      : new Config(config);
  }
  
  public static createTestInstance(config: Partial<Config> = {}): Config {
    return new Config(config);
  }
  
  // Glue defaults
  public getReadDatabaseName(): string {
    return this.glueDatabaseName;
  }

  public getWriteDatabaseName(): string {
    return this.glueDatabaseName;
  }
  
  public getResultsBucket(): string {
    return this.glueTablesBucket;
  }

  public getTablesBucket(): string {
    return this.glueTablesBucket;
  }

  public formatTableName(tableName: string, isWrite: boolean = false): string {
    return `"${tableName}"`;
  }

  public createTableQuery(tableName: string, columns: string): string {
    return `
      CREATE TABLE ${this.formatTableName(tableName, true)} (
        ${columns}
      ) WITH (format = 'iceberg')
    `;
  }

  public dropTableQuery(tableName: string): string {
    return `DROP TABLE IF EXISTS ${tableName}`;
  }

  public getExecutionContext(): { Database: string } {
    return { Database: this.getReadDatabaseName() };
  }

  /**
   * Extract bucket name from table name by removing view suffixes
   */
  public static sourceBucketFromTableName(name: string): string {
    return name.replace(/_(objects|packages)-view$/, "");
  }
}

export class S3Config extends Config {
  constructor(config?: Partial<Config>) {
    super({
      ...config,
      useS3Table: true
    });
  }

  public static createTestInstance(config: Partial<Config> = {}): S3Config {
    return new S3Config(config);
  }

  // S3 overrides
  public getWriteDatabaseName(): string {
    return this.s3TableDatabaseName;
  }

  public getTablesBucket(): string {
    return this.s3TablesBucket;
  }

  // Always use Glue bucket for Athena query results, even in S3Config
  public getResultsBucket(): string {
    return this.glueTablesBucket;
  }

  public getS3TableCatalogName(): string {
    return this.s3TablesBucket;
  }

  public formatTableName(tableName: string, isWrite: boolean = false): string {
    const dbName = isWrite ? this.getWriteDatabaseName() : this.getReadDatabaseName();
    return `${dbName}.${tableName}`;
  }

  public createTableQuery(tableName: string, columns: string): string {
    return `
      CREATE TABLE ${this.formatTableName(tableName, true)} (
        ${columns}
      ) LOCATION 's3://${this.getTablesBucket()}/${tableName}/'
    `;
  }

  public getExecutionContext(): { Catalog: string; Database: string } {
    return {
      Catalog: this.getS3TableCatalogName(),
      Database: this.getWriteDatabaseName()
    };
  }
}
