# The `/contentSets` Folder
The contents of this folder will be ignored by Git, _except_ for the `examples` folder. Use the `examples` folder as a starting point for your content sets.

Create a new folder within the `contentSets` folder, then use your new folder as a sandbox for developing your custom content sets to be used with the Light Installer.

## Custom Content Set Folder Structure
```
<light-installer>/contentSets
|__<Content Set Name>
   |__data8/
      |__<See the "data8" section below>
   |__ktx_cache/
      |__<See the "ktx_cache" section below>
   |__scripts/
      |__<See the "scripts" section below>
```

### `data8`
The contents of this folder should be a direct copy of the contents of the `data8` cache folder found in `C:/Users/<username>/AppData/Local/High Fidelity/Interface/data8`.

For instructions about correctly populating this folder, see the "Correctly Populating the `data8` and `ktx_cache` Folders" section below.

### `ktx_cache`
The contents of this folder should be a direct copy of the contents of the `data8` cache folder found in `C:/Users/<username>/AppData/Local/High Fidelity/Interface/ktx_cache`.

For instructions about correctly populating this folder, see the "Correctly Populating the `data8` and `ktx_cache` Folders" section below.

### Correctly Populating the `data8` and `ktx_cache` Folders
To correctly populate the `data8` and `ktx_cache` folders inside your custom content set's folder:
1. Open Interface
2. Navigate to the domain whose data you'd like to cache
3. Click `Edit` -> `Reload Content (Clears all caches)`
4. Fly around the domain so that your system caches all of the content.
5. Copy the contents of `C:/Users/<username>/AppData/Local/High Fidelity/Interface/data8` to `<light-installer>/contentSets/data8/`
6. Copy the contents of 

### `scripts`
The contents of this folder should contain a `defaultScripts.js` file, which Interface will read when it is launched from the Light Installer.

For an example `defaultScripts.js` file, open `<light-installer>/contentSets/example/scripts/defaultScripts.js`. That example `defaultScripts.js` file looks very similar to the RC81 `defaultScripts.js` file, with the following changes:
    - Uses the (as of RC81, deprecated) `Paths` API to get Interface's defaullt scripts location so that copying all default scripts into the custom content set directory is unnecessary.
    - An inclusion of an uncertified copy of the Appreciate v1.5 app.
    - The removal of the Interstitial Mode scripts, regardless of the user's `Window.interstitialModeEnabled` setting.

Follow that example's patterns when creating your custom set of default scripts.

Make sure to copy the scripts you reference in your `defaultScripts.js` file into the `scripts` custom content directory!