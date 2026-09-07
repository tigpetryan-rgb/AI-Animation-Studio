package com.aianimationstudio.runtime

/** Step 1 is a real standalone shell, not a claim that reconstruction is already wired. */
internal object CharacterMakerShellContract {
    const val APPLICATION_ID = "com.aianimationstudio.charactermaker"
    const val MODELING_ENABLED = false
    fun canCreate3D(referenceSelected: Boolean): Boolean = MODELING_ENABLED && referenceSelected
    fun acceptsImageMime(mimeType: String?): Boolean = mimeType?.startsWith("image/") == true
}
