package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CharacterMakerShellContractTest {
    @Test fun separateInstallationIdentity() {
        assertEquals("com.aianimationstudio.charactermaker", CharacterMakerShellContract.APPLICATION_ID)
        assertFalse(CharacterMakerShellContract.APPLICATION_ID == "com.aianimationstudio.runtime")
    }

    @Test fun unfinishedModelingNeverPretendsToBeReady() {
        assertFalse(CharacterMakerShellContract.canCreate3D(false))
        assertFalse(CharacterMakerShellContract.canCreate3D(true))
    }

    @Test fun imagePickerContract() {
        assertTrue(CharacterMakerShellContract.acceptsImageMime("image/png"))
        assertTrue(CharacterMakerShellContract.acceptsImageMime("image/jpeg"))
        assertFalse(CharacterMakerShellContract.acceptsImageMime("video/mp4"))
        assertFalse(CharacterMakerShellContract.acceptsImageMime(null))
    }
}
