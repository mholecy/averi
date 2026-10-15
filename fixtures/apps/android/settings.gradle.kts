// The Android lab app (docs/plans/2026-10-15-ground-truth-lab-app.md, phase 2): one module, no version catalog —
// a fixture, not a product. Versions are pinned to what a fresh checkout resolves without surprises.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "AveriLab"
