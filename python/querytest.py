import boto3
import duckdb
import pandas as pd
import quilt3 as q3

# Step 1: Look up S3 path from Glue
glue = boto3.client('glue', region_name='us-east-1')
table = glue.get_table(DatabaseName='userathenadatabase-mbq1ihawbzb7', Name='titanic_merged_objects')
s3_path = table['Table']['StorageDescriptor']['Location']

# Step 2: Connect to DuckDB
con = duckdb.connect()

# Step 3: Load extensions
con.execute("INSTALL httpfs; LOAD httpfs;")
con.execute("INSTALL iceberg; LOAD iceberg;")
con.execute("CREATE SECRET (TYPE s3, PROVIDER credential_chain);")
con.execute("SET unsafe_enable_version_guessing = true;")

# Step 4: Fetch search results from Quilt
#hits = [hit["_source"] for hit in q3.search("ext:.fastq.gz", limit=1000)]
#search_df = pd.DataFrame(hits)

#con.register("es_results", search_df)

# Step 5: Query Iceberg table from S3 and join with search results
df = con.execute(f"""
    SELECT
        pkg_name,
        logical_key,
        physical_key,
        regexp_extract(physical_key, '^s3://[^/]+/([^?]+)', 1) AS key_path,
        regexp_extract(physical_key, '[?&]versionId=([^&]+)', 1) AS version_id
    FROM iceberg_scan('{s3_path}', allow_moved_paths = true)
    LIMIT 10
""").fetchdf()
#    JOIN es_results ON es_results.key = pe.physical_key

print(df.head)