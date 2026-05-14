// Copyright (c) .NET Foundation. All rights reserved.
// Licensed under the MIT License.

import { expect } from 'chai';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { getCliRequest, processCliRequest, validateVersion, type VersionFilePaths } from '../scripts/updateVersion';
import sinon = require('sinon');

interface FixtureOptions {
    packageJsonVersion?: string;
    packageLockVersion?: string;
    packageLockRootVersion?: string;
    constantsVersion?: string;
}

interface FixtureState {
    packageJsonVersion: string;
    packageLockVersion: string;
    packageLockRootVersion: string;
    constantsVersion: string;
}

describe('updateVersion', () => {
    const tempDirs: string[] = [];
    let consoleLogStub: sinon.SinonStub;

    beforeEach(() => {
        consoleLogStub = sinon.stub(console, 'log');
    });

    afterEach(() => {
        consoleLogStub.restore();
        tempDirs.splice(0).forEach((dir) => rmSync(dir, { force: true, recursive: true }));
    });

    it('validates matching versions across tracked files', () => {
        const filePaths = createVersionFixture(tempDirs, { packageJsonVersion: '1.2.3' });

        expect(validateVersion(filePaths)).to.equal('1.2.3');
    });

    it('updates all tracked files for an explicit --version request', () => {
        const filePaths = createVersionFixture(tempDirs, { packageJsonVersion: '1.2.3' });

        processCliRequest(getCliRequest(['--version', '2.0.0']), filePaths);

        expect(readFixtureState(filePaths)).to.deep.equal({
            packageJsonVersion: '2.0.0',
            packageLockVersion: '2.0.0',
            packageLockRootVersion: '2.0.0',
            constantsVersion: '2.0.0',
        });
    });

    it('adds an alpha prerelease when --buildNumber is used on a stable version', () => {
        const filePaths = createVersionFixture(tempDirs, { packageJsonVersion: '1.2.3' });

        processCliRequest(getCliRequest(['--buildNumber', '20230517.1']), filePaths);

        expect(readFixtureState(filePaths)).to.deep.equal({
            packageJsonVersion: '1.2.3-alpha.20230517.1',
            packageLockVersion: '1.2.3-alpha.20230517.1',
            packageLockRootVersion: '1.2.3-alpha.20230517.1',
            constantsVersion: '1.2.3-alpha.20230517.1',
        });
    });

    it('appends the build number when the current version already has an alpha suffix', () => {
        const filePaths = createVersionFixture(tempDirs, { packageJsonVersion: '1.2.3-alpha.0' });

        processCliRequest(getCliRequest(['--buildNumber', '20230517.1']), filePaths);

        expect(readFixtureState(filePaths)).to.deep.equal({
            packageJsonVersion: '1.2.3-alpha.0.20230517.1',
            packageLockVersion: '1.2.3-alpha.0.20230517.1',
            packageLockRootVersion: '1.2.3-alpha.0.20230517.1',
            constantsVersion: '1.2.3-alpha.0.20230517.1',
        });
    });

    it('preserves trailing zeros in build numbers (e.g. 20230517.10)', () => {
        const filePaths = createVersionFixture(tempDirs, { packageJsonVersion: '1.2.3' });

        processCliRequest(getCliRequest(['--buildNumber', '20230517.10']), filePaths);

        expect(readFixtureState(filePaths)).to.deep.equal({
            packageJsonVersion: '1.2.3-alpha.20230517.10',
            packageLockVersion: '1.2.3-alpha.20230517.10',
            packageLockRootVersion: '1.2.3-alpha.20230517.10',
            constantsVersion: '1.2.3-alpha.20230517.10',
        });
    });

    it('fails validation when tracked versions drift', () => {
        const filePaths = createVersionFixture(tempDirs, {
            packageJsonVersion: '1.2.3',
            constantsVersion: '9.9.9',
        });

        expect(() => validateVersion(filePaths)).to.throw('Versions do not match.');
    });

    it('rejects shell-metacharacter version input before mutating files', () => {
        const filePaths = createVersionFixture(tempDirs, { packageJsonVersion: '1.2.3' });
        const originalState = readFixtureState(filePaths);

        expect(() => processCliRequest(getCliRequest(['--version', '2.0.0; touch hacked']), filePaths)).to.throw(
            'Invalid version "2.0.0; touch hacked".'
        );
        expect(readFixtureState(filePaths)).to.deep.equal(originalState);
    });
});

function createVersionFixture(tempDirs: string[], options: FixtureOptions = {}): VersionFilePaths {
    const packageJsonVersion = options.packageJsonVersion ?? '1.2.3';
    const packageLockVersion = options.packageLockVersion ?? packageJsonVersion;
    const packageLockRootVersion = options.packageLockRootVersion ?? packageJsonVersion;
    const constantsVersion = options.constantsVersion ?? packageJsonVersion;

    const tempDir = mkdtempSync(path.join(tmpdir(), 'update-version-test-'));
    tempDirs.push(tempDir);

    const srcDir = path.join(tempDir, 'src');
    mkdirSync(srcDir, { recursive: true });

    const filePaths: VersionFilePaths = {
        packageJsonPath: path.join(tempDir, 'package.json'),
        packageLockJsonPath: path.join(tempDir, 'package-lock.json'),
        constantsPath: path.join(srcDir, 'constants.ts'),
    };

    writeFileSync(
        filePaths.packageJsonPath,
        `${JSON.stringify(
            {
                name: 'fixture-package',
                version: packageJsonVersion,
            },
            undefined,
            4
        )}\n`
    );

    writeFileSync(
        filePaths.packageLockJsonPath,
        `${JSON.stringify(
            {
                name: 'fixture-package',
                version: packageLockVersion,
                lockfileVersion: 3,
                requires: true,
                packages: {
                    '': {
                        name: 'fixture-package',
                        version: packageLockRootVersion,
                    },
                },
            },
            undefined,
            4
        )}\n`
    );

    writeFileSync(
        filePaths.constantsPath,
        `// Copyright (c) .NET Foundation. All rights reserved.\n// Licensed under the MIT License.\n\nexport const version = '${constantsVersion}';\n`
    );

    return filePaths;
}

function readFixtureState(filePaths: VersionFilePaths): FixtureState {
    const packageJson = JSON.parse(readFileSync(filePaths.packageJsonPath, 'utf8')) as { version: string };
    const packageLockJson = JSON.parse(readFileSync(filePaths.packageLockJsonPath, 'utf8')) as {
        version: string;
        packages: {
            '': {
                version: string;
            };
        };
    };
    const constantsContents = readFileSync(filePaths.constantsPath, 'utf8');
    const constantsMatch = constantsContents.match(/version = '(.*)'/);

    if (!constantsMatch?.[1]) {
        throw new Error('Failed to read version from fixture constants.ts');
    }

    return {
        packageJsonVersion: packageJson.version,
        packageLockVersion: packageLockJson.version,
        packageLockRootVersion: packageLockJson.packages[''].version,
        constantsVersion: constantsMatch[1],
    };
}
