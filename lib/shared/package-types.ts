/**
 * Type definitions for package-related data structures.
 */

export interface PackageRevision {
  reghash: string;
  pkg_name: string;
  version: string;
  author: string;
  description: string;
  readme_filename: string;
  readme: string;
  dist_tag: string;
  dist_shasum: string;
  dist_tarball: string;
  created: string; // ISO 8601 date string
  size: number;
  npm_version: string;
  node_version: string;
  npm_user: string;
  maintainers: string;
  repository: string;
  homepage: string;
  bugs: string;
  license: string;
  time: string;
  extra: string;
  signature: string;
  signed: boolean;
}

export interface PackageTag {
  reghash: string;
  pkg_name: string;
  tag: string;
  version: string;
  timestamp: string; // ISO 8601 date string
}

export interface PackageEntry {
  reghash: string;
  pkg_name: string;
  entry_path: string;
  entry_size: number;
  entry_hash: string;
  entry_mode: number;
  entry_type: string;
}
