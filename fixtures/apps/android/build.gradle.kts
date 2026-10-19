plugins {
    id("com.android.application") version "8.13.0"
    id("org.jetbrains.kotlin.android") version "2.1.10"
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.10"
}

android {
    namespace = "dev.averi.lab"
    compileSdk = 36
    defaultConfig {
        applicationId = "dev.averi.lab"
        minSdk = 30
        targetSdk = 34
        versionCode = 1
        versionName = "1"
    }
    // Only the debug build is used: it is debuggable, so the capture script reads the state file with `run-as`.
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/lab-assets"))
}

kotlin { jvmToolchain(17) }

// The cell catalog both lab apps bundle lives once, beside them (fixtures/apps/cells.json): copied into the assets at
// build time, never duplicated in git.
val copyCells by tasks.registering(Copy::class) {
    from(layout.projectDirectory.file("../cells.json"))
    into(layout.buildDirectory.dir("generated/lab-assets"))
}
tasks.named("preBuild") { dependsOn(copyCells) }

dependencies {
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.ui:ui:1.7.8")
    implementation("androidx.compose.foundation:foundation:1.7.8")
    implementation("androidx.compose.material3:material3:1.3.1")
    // Views, for edges/scroll-collapsing alone (Edges.kt#CollapsingList): Settings' CoordinatorLayout + AppBarLayout +
    // CollapsingToolbarLayout, whose rows uiautomator dumps with inverted bounds (calibration.json #10).
    implementation("com.google.android.material:material:1.13.0")
}
