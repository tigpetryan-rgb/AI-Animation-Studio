package com.aianimationstudio.runtime

/** Standalone Character Maker contract: reconstruction is enabled only after the M58 adapter exists. */
internal object CharacterMakerShellContract {
    const val APPLICATION_ID = "com.aianimationstudio.charactermaker"
    const val MODELING_ENABLED = true
    fun canCreate3D(referenceSelected: Boolean): Boolean = MODELING_ENABLED && referenceSelected
    fun acceptsImageMime(mimeType: String?): Boolean = mimeType?.startsWith("image/") == true
}
