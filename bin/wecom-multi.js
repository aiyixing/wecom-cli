#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import { join, dirname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WRAPPER_CONFIG_DIR = join(os.homedir(), '.config', 'wecom-wrapper');
const PROFILES_DIR = join(WRAPPER_CONFIG_DIR, 'profiles');
const CURRENT_PROFILE_FILE = join(WRAPPER_CONFIG_DIR, 'current');

function ensureWrapperDirs() {
  if (!existsSync(WRAPPER_CONFIG_DIR)) {
    mkdirSync(WRAPPER_CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  if (!existsSync(PROFILES_DIR)) {
    mkdirSync(PROFILES_DIR, { recursive: true, mode: 0o700 });
  }
}

function getCurrentProfile() {
  ensureWrapperDirs();
  if (existsSync(CURRENT_PROFILE_FILE)) {
    return readFileSync(CURRENT_PROFILE_FILE, 'utf-8').trim();
  }
  return null;
}

function setCurrentProfile(profileName) {
  ensureWrapperDirs();
  const profileDir = join(PROFILES_DIR, profileName);
  if (!existsSync(profileDir)) {
    console.error(`Error: Profile "${profileName}" does not exist.`);
    console.error(`Use "wecom-cli user add ${profileName}" to create it first.`);
    process.exit(1);
  }
  writeFileSync(CURRENT_PROFILE_FILE, profileName, { mode: 0o600 });
  console.log(`Switched to profile: ${profileName}`);
}

function listProfiles() {
  ensureWrapperDirs();
  const current = getCurrentProfile();
  
  if (!existsSync(PROFILES_DIR)) {
    console.log('No profiles found.');
    console.log('Use "wecom-cli user add <name>" to create a profile.');
    return;
  }

  const profiles = readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  if (profiles.length === 0) {
    console.log('No profiles found.');
    console.log('Use "wecom-cli user add <name>" to create a profile.');
    return;
  }

  console.log('Available profiles:');
  profiles.forEach(profile => {
    const marker = profile === current ? '*' : ' ';
    console.log(`  ${marker} ${profile}`);
  });
  
  if (current) {
    console.log(`\nCurrent profile: ${current}`);
  } else {
    console.log('\nNo active profile. Use "wecom-cli user switch <name>" to select one.');
  }
}

function addProfile(profileName) {
  ensureWrapperDirs();
  const profileDir = join(PROFILES_DIR, profileName);
  
  if (existsSync(profileDir)) {
    console.error(`Error: Profile "${profileName}" already exists.`);
    process.exit(1);
  }

  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  console.log(`Created profile: ${profileName}`);
  console.log(`\nTo initialize this profile, run:`);
  console.log(`  wecom-cli --profile ${profileName} init`);
  console.log(`\nOr switch to it first:`);
  console.log(`  wecom-cli user switch ${profileName}`);
  console.log(`  wecom-cli init`);
}

function removeProfile(profileName) {
  ensureWrapperDirs();
  const profileDir = join(PROFILES_DIR, profileName);
  
  if (!existsSync(profileDir)) {
    console.error(`Error: Profile "${profileName}" does not exist.`);
    process.exit(1);
  }

  const current = getCurrentProfile();
  if (current === profileName) {
    if (existsSync(CURRENT_PROFILE_FILE)) {
      unlinkSync(CURRENT_PROFILE_FILE);
    }
    console.log(`Note: Removed current profile setting.`);
  }

  const removeDirRecursive = (dir) => {
    if (existsSync(dir)) {
      readdirSync(dir).forEach(file => {
        const curPath = join(dir, file);
        if (existsSync(curPath)) {
          const stat = require('node:fs').lstatSync(curPath);
          if (stat.isDirectory()) {
            removeDirRecursive(curPath);
          } else {
            unlinkSync(curPath);
          }
        }
      });
      rmdirSync(dir);
    }
  };

  removeDirRecursive(profileDir);
  console.log(`Removed profile: ${profileName}`);
}

function showCurrentProfile() {
  const current = getCurrentProfile();
  if (current) {
    const profileDir = join(PROFILES_DIR, current);
    console.log(`Current profile: ${current}`);
    console.log(`Config directory: ${profileDir}`);
  } else {
    console.log('No active profile.');
    console.log('Use "wecom-cli user switch <name>" to select a profile.');
    console.log('Or use "wecom-cli --profile <name> <command>" to run a command with a specific profile.');
  }
}

function showHelp() {
  console.log(`
wecom-cli - Multi-user wrapper for WeCom CLI

USAGE:
  wecom-cli [OPTIONS] [COMMAND] [ARGS...]

OPTIONS:
  --profile <name>    Use a specific profile for this command
  -h, --help          Show this help message

USER MANAGEMENT COMMANDS:
  user list           List all available profiles
  user add <name>     Create a new profile
  user remove <name>  Remove an existing profile
  user switch <name>  Set the default profile
  user current        Show the current active profile

EXAMPLES:
  wecom-cli user list
  wecom-cli user add work
  wecom-cli --profile work init
  wecom-cli user switch personal
  wecom-cli msg send_message '{"content": "Hello"}'

ENVIRONMENT VARIABLES:
  WECOM_PROFILE       Set the active profile (can be overridden by --profile)
  WECOM_CLI_CONFIG_DIR  Directly set config directory (overrides profile settings)

NOTE:
  The wrapper manages multiple profiles by setting WECOM_CLI_CONFIG_DIR
  environment variable before invoking the underlying wecom-cli binary.
  Each profile has its own isolated configuration directory.
`);
}

function getPlatformPackage() {
  const platform = os.platform();
  const arch = os.arch();

  const platformMap = {
    'darwin-arm64': '@wecom/cli-darwin-arm64',
    'darwin-x64': '@wecom/cli-darwin-x64',
    'linux-arm64': '@wecom/cli-linux-arm64',
    'linux-x64': '@wecom/cli-linux-x64',
    'win32-x64': '@wecom/cli-win32-x64',
  };

  const key = `${platform}-${arch}`;
  const pkg = platformMap[key];

  if (!pkg) {
    console.error(
      `Error: unsupported platform ${platform}-${arch}.\n` +
        `Supported platforms: ${Object.keys(platformMap).join(', ')}`,
    );
    process.exit(1);
  }

  return pkg;
}

function getBinaryPath() {
  const pkg = getPlatformPackage();
  const binaryName = os.platform() === 'win32' ? 'wecom-cli.exe' : 'wecom-cli';

  try {
    const pkgDir = require.resolve(`${pkg}/package.json`);
    return join(pkgDir, '..', 'bin', binaryName);
  } catch {
    console.error(
      `Error: cannot find @wecom/cli binary.\n` +
        `Please try reinstalling: npm install @wecom/cli\n\n` +
        `If the problem persists, check:\n` +
        `  1. Your npm config does not disable optional dependencies (--no-optional)\n` +
        `  2. Your platform (${os.platform()}-${os.arch()}) is supported`,
    );
    process.exit(1);
  }
}

function resolveProfile(args) {
  let profileFromArg = null;
  const remainingArgs = [];
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--profile' && i + 1 < args.length) {
      profileFromArg = args[i + 1];
      i++;
    } else if (arg.startsWith('--profile=')) {
      profileFromArg = arg.slice('--profile='.length);
    } else {
      remainingArgs.push(arg);
    }
  }

  const envProfile = process.env.WECOM_PROFILE;
  
  let activeProfile = null;
  if (profileFromArg) {
    activeProfile = profileFromArg;
  } else if (envProfile) {
    activeProfile = envProfile;
  } else {
    activeProfile = getCurrentProfile();
  }

  return { activeProfile, remainingArgs };
}

function isUserCommand(args) {
  return args.length >= 1 && args[0] === 'user';
}

function handleUserCommand(args) {
  if (args.length < 2) {
    console.error('Error: Missing subcommand for "user".');
    console.error('Usage: wecom-cli user <list|add|remove|switch|current>');
    process.exit(1);
  }

  const subcommand = args[1];

  switch (subcommand) {
    case 'list':
      listProfiles();
      break;
    case 'add':
      if (args.length < 3) {
        console.error('Error: Missing profile name for "user add".');
        console.error('Usage: wecom-cli user add <name>');
        process.exit(1);
      }
      addProfile(args[2]);
      break;
    case 'remove':
      if (args.length < 3) {
        console.error('Error: Missing profile name for "user remove".');
        console.error('Usage: wecom-cli user remove <name>');
        process.exit(1);
      }
      removeProfile(args[2]);
      break;
    case 'switch':
      if (args.length < 3) {
        console.error('Error: Missing profile name for "user switch".');
        console.error('Usage: wecom-cli user switch <name>');
        process.exit(1);
      }
      setCurrentProfile(args[2]);
      break;
    case 'current':
      showCurrentProfile();
      break;
    default:
      console.error(`Error: Unknown subcommand "user ${subcommand}".`);
      console.error('Available: list, add, remove, switch, current');
      process.exit(1);
  }
}

function executeWithProfile(profile, args) {
  const binaryPath = getBinaryPath();
  
  const env = { ...process.env };
  
  if (profile && !process.env.WECOM_CLI_CONFIG_DIR) {
    ensureWrapperDirs();
    const profileDir = join(PROFILES_DIR, profile);
    
    if (!existsSync(profileDir)) {
      console.error(`Error: Profile "${profile}" does not exist.`);
      console.error(`Use "wecom-cli user add ${profile}" to create it first.`);
      process.exit(1);
    }
    
    env.WECOM_CLI_CONFIG_DIR = profileDir;
    
    if (args.length === 0 || (args.length === 1 && (args[0] === '-h' || args[0] === '--help'))) {
    } else {
      console.error(`Using profile: ${profile}`);
      console.error(`Config directory: ${profileDir}`);
    }
  }

  try {
    execFileSync(binaryPath, args, {
      stdio: 'inherit',
      env: env,
    });
  } catch (error) {
    if (error.status != null) {
      process.exit(error.status);
    }
    throw error;
  }
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('-h') || args.includes('--help')) {
    if (isUserCommand(args.filter(a => a !== '-h' && a !== '--help'))) {
      const { remainingArgs } = resolveProfile(args);
      handleUserCommand(remainingArgs);
    } else {
      showHelp();
    }
    return;
  }

  const { activeProfile, remainingArgs } = resolveProfile(args);

  if (isUserCommand(remainingArgs)) {
    handleUserCommand(remainingArgs);
    return;
  }

  executeWithProfile(activeProfile, remainingArgs);
}

main();
