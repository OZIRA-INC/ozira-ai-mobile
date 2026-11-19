'use strict';

function buildAppConfig(base, environment) {
  if (!base || !['staging', 'production'].includes(environment)) {
    throw new Error('An explicit staging or production build environment is required.');
  }
  if (environment === 'production') return base;

  return {
    ...base,
    name: 'OZIRA AI Staging',
    scheme: 'ozira-staging',
    ios: { ...base.ios, bundleIdentifier: 'com.ozira.ai.staging' },
    android: { ...base.android, package: 'com.ozira.ai.staging' },
  };
}

module.exports = { buildAppConfig };
