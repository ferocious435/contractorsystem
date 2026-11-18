import {registerHooks} from 'node:module';
// Startup regression guard: importing any legacy SQL adapter is already a failure.
registerHooks({resolve(specifier,context,next){
 if(/(?:writing-db|letters-db|letter-rpc-test-adapter)\.mjs$/u.test(specifier))throw Error('BOQ test forbids legacy SQL import: '+specifier);
 return next(specifier,context);
}});
