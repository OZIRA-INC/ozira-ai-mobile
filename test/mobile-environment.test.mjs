import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const configSource = await readFile(new URL('../src/config.js', import.meta.url), 'utf8');
const { buildAppConfig } = require('../src/appConfig');
const baseExpoConfig = require('../app.json').expo;
const easConfig = JSON.parse(await readFile(new URL('../eas.json', import.meta.url), 'utf8'));

function loadRuntimeConfig(env) {
  const executable = configSource
    .replace('export const appEnvironment =', 'exports.appEnvironment =')
    .replace('export const config =', 'exports.config =');
  const exports = {};
  new Function('process', 'exports', executable)({ env }, exports);
  return exports;
}

test('Staging API and Supabase project are bound to explicit project configuration', () => {
  const result = loadRuntimeConfig({
    EXPO_PUBLIC_OZIRA_ENV: 'staging',
    EXPO_PUBLIC_SUPABASE_URL: 'https://gdydxlmidnshluvpynml.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_staging-fixture',
  });

  assert.equal(result.appEnvironment, 'staging');
  assert.equal(result.config.API_BASE, 'https://ozira-ai-staging-staging.up.railway.app');
  assert.equal(result.config.SUPABASE_URL, 'https://gdydxlmidnshluvpynml.supabase.co');
  assert.equal(result.config.SUPABASE_AUTH_STORAGE_KEY, 'sb-gdydxlmidnshluvpynml-auth-token');
});

test('Production mapping remains a separate explicit profile', () => {
  const result = loadRuntimeConfig({
    EXPO_PUBLIC_OZIRA_ENV: 'production',
    EXPO_PUBLIC_SUPABASE_URL: 'https://gmdsprtbbqnjubbpytfc.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_production-fixture',
  });

  assert.equal(result.appEnvironment, 'production');
  assert.equal(result.config.API_BASE, 'https://ozira-ai-production.up.railway.app');
  assert.equal(result.config.SUPABASE_URL, 'https://gmdsprtbbqnjubbpytfc.supabase.co');
  assert.equal(result.config.SUPABASE_AUTH_STORAGE_KEY, 'sb-gmdsprtbbqnjubbpytfc-auth-token');
});

test('EAS build profiles explicitly select matching OZIRA environments', () => {
  const resolveProfile = name => {
    const profile = easConfig.build[name];
    const parent = profile.extends ? resolveProfile(profile.extends) : {};
    return { ...parent, ...profile, env: { ...(parent.env || {}), ...(profile.env || {}) } };
  };
  for (const profileName of ['development', 'preview', 'staging']) {
    const profile = resolveProfile(profileName);
    assert.equal(profile.env.EXPO_PUBLIC_OZIRA_ENV, 'staging');
    assert.equal(profile.environment, 'preview');
  }
  const production = resolveProfile('production');
  assert.equal(production.env.EXPO_PUBLIC_OZIRA_ENV, 'production');
  assert.equal(production.environment, 'production');
});

test('missing, unknown, mismatched, or secret-key build configuration fails closed', () => {
  for (const env of [
    {},
    { EXPO_PUBLIC_OZIRA_ENV: 'preview' },
    { EXPO_PUBLIC_OZIRA_ENV: 'staging', EXPO_PUBLIC_SUPABASE_URL: 'https://gmdsprtbbqnjubbpytfc.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture' },
    { EXPO_PUBLIC_OZIRA_ENV: 'staging', EXPO_PUBLIC_SUPABASE_URL: 'https://gdydxlmidnshluvpynml.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_fixture' },
  ]) {
    assert.throws(() => loadRuntimeConfig(env));
  }
});

test('staging app identifiers are isolated and production keeps the established identifiers', () => {
  const staging = buildAppConfig(baseExpoConfig, 'staging');
  const production = buildAppConfig(baseExpoConfig, 'production');

  assert.equal(staging.name, 'OZIRA AI Staging');
  assert.equal(staging.ios.bundleIdentifier, 'com.ozira.ai.staging');
  assert.equal(staging.android.package, 'com.ozira.ai.staging');
  assert.equal(staging.scheme, 'ozira-staging');
  assert.equal(production.ios.bundleIdentifier, 'com.ozira.ai');
  assert.equal(production.android.package, 'com.ozira.ai');
  assert.equal(production.scheme, 'ozira');
  assert.throws(() => buildAppConfig(baseExpoConfig, undefined), /explicit staging or production/);
});
