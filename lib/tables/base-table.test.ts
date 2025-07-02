import { PackageRevisionTable } from "./package-revision";
import { PackageTagTable } from "./package-tag";
import { PackageEntryTable } from "./package-entry";
import { createTableTestSuite } from "../shared/test-utils";

/**
 * Consolidated test suite for all package-related tables.
 * This file replaces the individual test files for package-revision, package-tag, and package-entry tables.
 */

describe("Package Tables", () => {
    describe("PackageRevisionTable", createTableTestSuite(
        PackageRevisionTable,
        "package_revision",
        {
            insertQueryContains: [
                "s.timestamp != 'latest'"
            ]
        }
    ));

    describe("PackageTagTable", createTableTestSuite(
        PackageTagTable,
        "package_tag",
        {
            insertQueryContains: [
                "s.timestamp = 'latest'"
            ]
        }
    ));

    describe("PackageEntryTable", createTableTestSuite(
        PackageEntryTable,
        "package_entry"
    ));
});
