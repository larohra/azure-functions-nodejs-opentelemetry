// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { readFileSync, writeFileSync } from 'fs';
import * as parseArgs from 'minimist';
import * as path from 'path';
import * as semver from 'semver';

const repoRoot = path.join(__dirname, '..');
const constantsVersionRegex = /version = '(.*)'/i;
const usageText = `This script can be used to either update the version of the library or validate that the repo is in a valid state with regards to versioning.

Example usage:

npm run updateVersion -- --version 3.3.0
npm run updateVersion -- --buildNumber 20230517.1
npm run updateVersion -- --validate`;

export interface VersionFilePaths {
    packageJsonPath: string;
    packageLockJsonPath: string;
    constantsPath: string;
}

interface PackageManifest {
    version?: string;
    [key: string]: unknown;
}

interface PackageLockManifest extends PackageManifest {
    packages?: {
        [key: string]: PackageManifest | undefined;
    };
}

interface CurrentVersions {
    packageJsonVersion: string;
    packageLockVersion: string;
    packageLockRootVersion: string;
    constantsVersion: string;
}

interface RepoVersionState {
    packageJson: PackageManifest;
    packageLockJson: PackageLockManifest;
    constantsFileContents: string;
    currentVersions: CurrentVersions;
}

export type CliRequest =
    | { kind: 'validate' }
    | { kind: 'version'; version: string }
    | { kind: 'buildNumber'; buildNumber: string }
    | { kind: 'invalid' };

const defaultVersionFilePaths: VersionFilePaths = {
    packageJsonPath: path.join(repoRoot, 'package.json'),
    packageLockJsonPath: path.join(repoRoot, 'package-lock.json'),
    constantsPath: path.join(repoRoot, 'src', 'constants.ts'),
};

export function main(
    argv: string[] = process.argv.slice(2),
    filePaths: VersionFilePaths = defaultVersionFilePaths
): void {
    const request = getCliRequest(argv);
    processCliRequest(request, filePaths);
}

export function getCliRequest(argv: string[]): CliRequest {
    const args = parseArgs(argv);
    return getCliRequestFromArgs(args);
}

export function getCliRequestFromArgs(args: parseArgs.ParsedArgs): CliRequest {
    if (args.validate) {
        return { kind: 'validate' };
    }

    const version = normalizeCliValue(args.version);
    if (version !== undefined) {
        return { kind: 'version', version };
    }

    const buildNumber = normalizeCliValue(args.buildNumber);
    if (buildNumber !== undefined) {
        return { kind: 'buildNumber', buildNumber };
    }

    return { kind: 'invalid' };
}

export function processCliRequest(request: CliRequest, filePaths: VersionFilePaths = defaultVersionFilePaths): void {
    switch (request.kind) {
        case 'validate':
            validateVersion(filePaths);
            return;
        case 'version':
            updateVersion(request.version, filePaths);
            return;
        case 'buildNumber': {
            const currentVersion = validateVersion(filePaths);
            const newVersion = buildVersionFromBuildNumber(currentVersion, request.buildNumber);
            updateVersion(newVersion, filePaths);
            return;
        }
        default:
            console.log(usageText);
            throw new Error('Invalid arguments');
    }
}

export function validateVersion(filePaths: VersionFilePaths = defaultVersionFilePaths): string {
    const { currentVersions } = readRepoVersionState(filePaths);
    const versions = [
        currentVersions.packageJsonVersion,
        currentVersions.packageLockVersion,
        currentVersions.packageLockRootVersion,
        currentVersions.constantsVersion,
    ];

    console.log('Found the following versions:');
    console.log(`- package.json: ${currentVersions.packageJsonVersion}`);
    console.log(`- package-lock.json: ${currentVersions.packageLockVersion}`);
    console.log(`- package-lock.json packages[""]: ${currentVersions.packageLockRootVersion}`);
    console.log(`- src/constants.ts: ${currentVersions.constantsVersion}`);

    if (!versions.every(isValidSemver)) {
        throw new Error('Failed to detect valid versions in all expected files');
    } else if (!versions.every((version) => version === currentVersions.packageJsonVersion)) {
        throw new Error('Versions do not match.');
    } else {
        console.log('Versions match! 🎉');
        return currentVersions.packageJsonVersion;
    }
}

export function buildVersionFromBuildNumber(currentVersion: string, buildNumber: string): string {
    const newVersion = currentVersion.includes('alpha')
        ? `${currentVersion}.${buildNumber}`
        : `${currentVersion}-alpha.${buildNumber}`;

    assertValidVersion(newVersion);
    return newVersion;
}

export function updateVersion(newVersion: string, filePaths: VersionFilePaths = defaultVersionFilePaths): void {
    assertValidVersion(newVersion);

    const state = readRepoVersionState(filePaths);
    const rootPackage = state.packageLockJson.packages?.[''];
    if (!rootPackage) {
        throw new Error('Failed to find version entry in package-lock.json packages[""].');
    }

    state.packageJson.version = newVersion;
    state.packageLockJson.version = newVersion;
    rootPackage.version = newVersion;

    const newConstantsFileContents = replaceVersionByRegex(
        state.constantsFileContents,
        constantsVersionRegex,
        newVersion
    );

    writeJsonFile(filePaths.packageJsonPath, state.packageJson);
    console.log(
        `Updated ${filePaths.packageJsonPath} from ${state.currentVersions.packageJsonVersion} to version ${newVersion}`
    );

    writeJsonFile(filePaths.packageLockJsonPath, state.packageLockJson);
    console.log(
        `Updated ${filePaths.packageLockJsonPath} from ${state.currentVersions.packageLockVersion} to version ${newVersion}`
    );

    writeFileSync(filePaths.constantsPath, newConstantsFileContents);
    console.log(
        `Updated ${filePaths.constantsPath} from ${state.currentVersions.constantsVersion} to version ${newVersion}`
    );
}

function normalizeCliValue(value: unknown): string | undefined {
    if (typeof value === 'string' || typeof value === 'number') {
        return `${value}`;
    }

    return undefined;
}

function readRepoVersionState(filePaths: VersionFilePaths): RepoVersionState {
    const packageJson = readJsonFile<PackageManifest>(filePaths.packageJsonPath);
    const packageLockJson = readJsonFile<PackageLockManifest>(filePaths.packageLockJsonPath);
    const packageLockRootPackage = packageLockJson.packages?.[''];
    const constantsFileContents = readFileSync(filePaths.constantsPath, 'utf8');

    return {
        packageJson,
        packageLockJson,
        constantsFileContents,
        currentVersions: {
            packageJsonVersion: getJsonVersion(packageJson, filePaths.packageJsonPath),
            packageLockVersion: getJsonVersion(packageLockJson, filePaths.packageLockJsonPath),
            packageLockRootVersion: getJsonVersion(
                packageLockRootPackage,
                `${filePaths.packageLockJsonPath} packages[""]`
            ),
            constantsVersion: getVersionByRegex(constantsFileContents, constantsVersionRegex, filePaths.constantsPath),
        },
    };
}

function readJsonFile<T>(filePath: string): T {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

function writeJsonFile(filePath: string, json: object): void {
    writeFileSync(filePath, `${JSON.stringify(json, undefined, 4)}\n`);
}

function getJsonVersion(json: PackageManifest | undefined, filePath: string): string {
    if (!json || typeof json.version !== 'string') {
        throw new Error(`Failed to find version in "${filePath}".`);
    }

    return json.version;
}

function getVersionByRegex(fileContents: string, regex: RegExp, filePath: string): string {
    const match = fileContents.match(regex);
    if (!match || !match[1]) {
        throw new Error(`Failed to find match for "${regex.source}" in "${filePath}".`);
    }

    return match[1];
}

function replaceVersionByRegex(fileContents: string, regex: RegExp, newVersion: string): string {
    const match = fileContents.match(regex);
    if (!match || !match[0] || !match[1]) {
        throw new Error(`Failed to find match for "${regex.source}".`);
    }

    const [oldLine, oldVersion] = match;
    const newLine = oldLine.replace(oldVersion, newVersion);
    return fileContents.replace(oldLine, newLine);
}

function assertValidVersion(version: string): void {
    if (!isValidSemver(version)) {
        throw new Error(`Invalid version "${version}".`);
    }
}

function isValidSemver(version: string): boolean {
    return semver.parse(version) !== null;
}

if (require.main === module) {
    main();
}
