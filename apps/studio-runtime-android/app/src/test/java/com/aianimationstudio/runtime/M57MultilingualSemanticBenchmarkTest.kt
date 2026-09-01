package com.aianimationstudio.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class M57MultilingualSemanticBenchmarkTest {
    private val sourceCommit = "c".repeat(40)
    private val referenceSha = "d".repeat(64)
    private val actorId = "benchmark-character"
    private val compiler = NaturalLanguageSceneCompiler(NativeSupportedSubsetSemanticProbe)

    private data class BenchmarkCase(
        val id: String,
        val text: String,
        val language: NativeSceneLanguage,
        val status: NativeSceneSemanticStatus,
        val concept: NativeSceneConcept? = null,
    )

    @Test
    fun `three-language deterministic semantic benchmark has 300 gated cases`() {
        val cases = benchmarkCases()
        assertEquals("The benchmark corpus size is a release gate and must not silently shrink.", 300, cases.size)

        val failures = mutableListOf<String>()
        cases.forEach { case ->
            val first = compile(case.text)
            val second = compile(case.text)

            if (first != second) {
                failures += "${case.id}: non-deterministic compilation"
                return@forEach
            }
            if (first.status != case.status) {
                failures += "${case.id}: status=${first.status}, expected=${case.status}; diagnostics=${first.diagnostics.map { it.code }}"
                return@forEach
            }

            when (case.status) {
                NativeSceneSemanticStatus.VALID_EXECUTABLE -> {
                    val ir = first.ir
                    if (ir == null) {
                        failures += "${case.id}: executable case returned no IR"
                        return@forEach
                    }
                    if (ir.detectedLanguage != case.language) {
                        failures += "${case.id}: language=${ir.detectedLanguage}, expected=${case.language}"
                    }
                    if (case.concept != null && ir.actions.none { it.concept == case.concept }) {
                        failures += "${case.id}: missing executable concept ${case.concept}; actions=${ir.actions.map { it.concept }}"
                    }
                    if (NativeSceneCapabilityRegistry.unsupported(ir.actions).isNotEmpty()) {
                        failures += "${case.id}: executable case contains unsupported action"
                    }
                    if (!first.matchesIdentity(case.text, referenceSha, sourceCommit)) {
                        failures += "${case.id}: provenance identity mismatch"
                    }
                }

                NativeSceneSemanticStatus.VALID_BUT_UNSUPPORTED_CAPABILITY -> {
                    val ir = first.ir
                    if (ir == null) {
                        failures += "${case.id}: unsupported-capability case returned no semantic IR"
                        return@forEach
                    }
                    if (ir.detectedLanguage != case.language) {
                        failures += "${case.id}: language=${ir.detectedLanguage}, expected=${case.language}"
                    }
                    if (case.concept != null && ir.actions.none { it.concept == case.concept }) {
                        failures += "${case.id}: missing semantic concept ${case.concept}; actions=${ir.actions.map { it.concept }}"
                    }
                    if (first.diagnostics.none { it.code == "UNSUPPORTED_CAPABILITY" }) {
                        failures += "${case.id}: unsupported semantic case lacks UNSUPPORTED_CAPABILITY diagnostic"
                    }
                }

                NativeSceneSemanticStatus.AMBIGUOUS_SEMANTICS -> {
                    if (first.ir != null) failures += "${case.id}: ambiguous case fabricated executable IR"
                    if (first.diagnostics.none { it.code == "AMBIGUOUS_SEMANTICS" }) {
                        failures += "${case.id}: ambiguous case lacks AMBIGUOUS_SEMANTICS diagnostic"
                    }
                }

                else -> failures += "${case.id}: benchmark corpus contains unexpected status ${case.status}"
            }
        }

        assertTrue(
            "M57 multilingual benchmark failures (${failures.size}):\n${failures.take(40).joinToString("\n")}",
            failures.isEmpty(),
        )
    }

    private fun compile(text: String): NativeSceneCompilation = compiler.compile(
        NativeSceneSemanticRequest(
            originalText = text,
            sourceCommit = sourceCommit,
            referenceSha256 = referenceSha,
            actorId = actorId,
        ),
    )

    private fun benchmarkCases(): List<BenchmarkCase> {
        val cases = mutableListOf<BenchmarkCase>()

        supportedBase().forEachIndexed { baseIndex, base ->
            supportedDecorations(base.language, base.text).forEachIndexed { variantIndex, text ->
                cases += base.copy(id = "supported-${baseIndex + 1}-${variantIndex + 1}", text = text)
            }
        }

        unsupportedBase().forEachIndexed { baseIndex, base ->
            unsupportedDecorations(base.language, base.text).forEachIndexed { variantIndex, text ->
                cases += base.copy(id = "unsupported-${baseIndex + 1}-${variantIndex + 1}", text = text)
            }
        }

        ambiguousBase().forEachIndexed { index, base ->
            cases += base.copy(id = "ambiguous-${index + 1}")
        }

        return cases
    }

    private fun supportedBase(): List<BenchmarkCase> = listOf(
        // Armenian: 16 bases.
        executable("hy-wait-1", "Կերպարը սպասում է։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.WAIT),
        executable("hy-wait-2", "Կերպարը հանգիստ մնում է։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.WAIT),
        executable("hy-wait-3", "Կերպարը հանգիստ կանգնում է։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.WAIT),
        executable("hy-wait-4", "Կերպարը անշարժ է։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.WAIT),
        executable("hy-sit-1", "Կերպարը նստում է աթոռին։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.SIT),
        executable("hy-sit-2", "Կերպարը նստած է։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.SIT),
        executable("hy-sit-3", "Կերպարը դանդաղ նստում է։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.SIT),
        executable("hy-sit-4", "Տեսարանում կերպարը նստում է։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.SIT),
        executable("hy-react-1", "Կերպարը զարմանում է։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.REACT),
        executable("hy-react-2", "Կերպարը արձագանքում է տեղի ունեցածին։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.REACT),
        executable("hy-react-3", "Կերպարը զարմացած արձագանքում է։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.REACT),
        executable("hy-react-4", "Կերպարը զարմանք է ցույց տալիս։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.REACT),
        executable("hy-speak-1", "Կերպարը ասում է «Բարև»։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.SPEAK),
        executable("hy-speak-2", "Կերպարը խոսում է «Բարի լույս»։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.SPEAK),
        executable("hy-speak-3", "Կերպարը արտասանում է «Ես այստեղ եմ»։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.SPEAK),
        executable("hy-speak-4", "Կերպարը պետք է արտասանել «Շնորհակալություն»։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.SPEAK),

        // English: 16 bases.
        executable("en-wait-1", "The character waits.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.WAIT),
        executable("en-wait-2", "The character is waiting.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.WAIT),
        executable("en-wait-3", "The character should remain still.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.WAIT),
        executable("en-wait-4", "The character stands quietly.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.WAIT),
        executable("en-sit-1", "The character sits.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.SIT),
        executable("en-sit-2", "The character is sitting.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.SIT),
        executable("en-sit-3", "The character should sit.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.SIT),
        executable("en-sit-4", "Please sit the character.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.SIT),
        executable("en-react-1", "The character reacts.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.REACT),
        executable("en-react-2", "The character is surprised.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.REACT),
        executable("en-react-3", "The character should react.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.REACT),
        executable("en-react-4", "A surprised character reacts.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.REACT),
        executable("en-speak-1", "The character says \"Hello\".", NativeSceneLanguage.ENGLISH, NativeSceneConcept.SPEAK),
        executable("en-speak-2", "The character speaks \"Good morning\".", NativeSceneLanguage.ENGLISH, NativeSceneConcept.SPEAK),
        executable("en-speak-3", "Make the character say \"I am here\".", NativeSceneLanguage.ENGLISH, NativeSceneConcept.SPEAK),
        executable("en-speak-4", "Let the character speak \"Thank you\".", NativeSceneLanguage.ENGLISH, NativeSceneConcept.SPEAK),

        // Russian: 16 bases.
        executable("ru-wait-1", "Персонаж ждёт.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.WAIT),
        executable("ru-wait-2", "Персонаж ожидает.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.WAIT),
        executable("ru-wait-3", "Персонаж стоит спокойно.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.WAIT),
        executable("ru-wait-4", "Персонаж остаётся неподвижно.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.WAIT),
        executable("ru-sit-1", "Персонаж садится на стул.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.SIT),
        executable("ru-sit-2", "Персонаж сидит.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.SIT),
        executable("ru-sit-3", "Персонаж медленно садится.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.SIT),
        executable("ru-sit-4", "В сцене персонаж сидит спокойно.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.SIT),
        executable("ru-react-1", "Персонаж реагирует.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.REACT),
        executable("ru-react-2", "Персонаж удивляется.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.REACT),
        executable("ru-react-3", "Персонаж удивлённо реагирует.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.REACT),
        executable("ru-react-4", "Персонаж выглядит удивлённым.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.REACT),
        executable("ru-speak-1", "Персонаж говорит «Привет».", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.SPEAK),
        executable("ru-speak-2", "Персонаж произносит «Доброе утро».", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.SPEAK),
        executable("ru-speak-3", "Персонаж скажет «Я здесь».", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.SPEAK),
        executable("ru-speak-4", "Пусть персонаж говорит «Спасибо».", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.SPEAK),
    )

    private fun unsupportedBase(): List<BenchmarkCase> = listOf(
        // Armenian: 10 bases.
        unsupported("hy-walk-1", "Կերպարը քայլում է դեպի պատուհանը։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.WALK_TO),
        unsupported("hy-walk-2", "Կերպարը մոտենում է պատուհանին։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.WALK_TO),
        unsupported("hy-run-1", "Կերպարը վազում է դեպի դուռը։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.RUN_TO),
        unsupported("hy-run-2", "Կերպարը վազում է առաջ։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.RUN_TO),
        unsupported("hy-pick-1", "Կերպարը վերցնում է գիրքը։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.PICK_UP),
        unsupported("hy-pick-2", "Կերպարը վերցնում է բաժակը։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.PICK_UP),
        unsupported("hy-open-1", "Կերպարը բացում է դուռը։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.OPEN),
        unsupported("hy-open-2", "Կերպարը բացում է պատուհանը։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.OPEN),
        unsupported("hy-close-1", "Կերպարը փակում է դուռը։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.CLOSE),
        unsupported("hy-close-2", "Կերպարը փակում է պատուհանը։", NativeSceneLanguage.ARMENIAN, NativeSceneConcept.CLOSE),

        // English: 10 bases.
        unsupported("en-walk-1", "The character walks toward the window.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.WALK_TO),
        unsupported("en-walk-2", "The character approaches the window.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.WALK_TO),
        unsupported("en-run-1", "The character runs toward the door.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.RUN_TO),
        unsupported("en-run-2", "The character should run forward.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.RUN_TO),
        unsupported("en-pick-1", "The character picks up the book.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.PICK_UP),
        unsupported("en-pick-2", "The character should pick up the cup.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.PICK_UP),
        unsupported("en-open-1", "The character opens the door.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.OPEN),
        unsupported("en-open-2", "The character should open the window.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.OPEN),
        unsupported("en-close-1", "The character closes the door.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.CLOSE),
        unsupported("en-close-2", "The character should close the window.", NativeSceneLanguage.ENGLISH, NativeSceneConcept.CLOSE),

        // Russian: 10 bases.
        unsupported("ru-walk-1", "Персонаж идёт к окну.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.WALK_TO),
        unsupported("ru-walk-2", "Персонаж подходит к окну.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.WALK_TO),
        unsupported("ru-run-1", "Персонаж бежит к двери.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.RUN_TO),
        unsupported("ru-run-2", "Персонаж побежит вперёд.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.RUN_TO),
        unsupported("ru-pick-1", "Персонаж берёт книгу.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.PICK_UP),
        unsupported("ru-pick-2", "Персонаж поднимает чашку.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.PICK_UP),
        unsupported("ru-open-1", "Персонаж открывает дверь.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.OPEN),
        unsupported("ru-open-2", "Нужно открыть окно.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.OPEN),
        unsupported("ru-close-1", "Персонаж закрывает дверь.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.CLOSE),
        unsupported("ru-close-2", "Нужно закрыть окно.", NativeSceneLanguage.RUSSIAN, NativeSceneConcept.CLOSE),
    )

    private fun ambiguousBase(): List<BenchmarkCase> = listOf(
        ambiguous("hy-amb-1", "Կերպարը հիշում է իր մանկությունը։", NativeSceneLanguage.ARMENIAN),
        ambiguous("hy-amb-2", "Կերպարը մտածում է ապագայի մասին։", NativeSceneLanguage.ARMENIAN),
        ambiguous("hy-amb-3", "Կերպարը նայում է գույներին։", NativeSceneLanguage.ARMENIAN),
        ambiguous("hy-amb-4", "Տեսարանը խաղաղ է ու լուռ։", NativeSceneLanguage.ARMENIAN),
        ambiguous("hy-amb-5", "Կերպարը զգում է տխրություն։", NativeSceneLanguage.ARMENIAN),
        ambiguous("hy-amb-6", "Կերպարը ժպտում է անորոշ պատճառով։", NativeSceneLanguage.ARMENIAN),
        ambiguous("hy-amb-7", "Կերպարը հիշում է տունը։", NativeSceneLanguage.ARMENIAN),
        ambiguous("hy-amb-8", "Կերպարը երազում է ճանապարհորդության մասին։", NativeSceneLanguage.ARMENIAN),
        ambiguous("hy-amb-9", "Կերպարը լսում է հեռավոր ձայն։", NativeSceneLanguage.ARMENIAN),
        ambiguous("hy-amb-10", "Կերպարը ուսումնասիրում է սենյակը։", NativeSceneLanguage.ARMENIAN),
        ambiguous("hy-amb-11", "Տեսարանը փոխանցում է կարոտի զգացում։", NativeSceneLanguage.ARMENIAN),
        ambiguous("hy-amb-12", "Կերպարը կասկածում է իր որոշմանը։", NativeSceneLanguage.ARMENIAN),
        ambiguous("hy-amb-13", "Կերպարը մտածկոտ է։", NativeSceneLanguage.ARMENIAN),
        ambiguous("hy-amb-14", "Կերպարը հիանում է լույսով։", NativeSceneLanguage.ARMENIAN),
        ambiguous("hy-amb-15", "Կերպարը անհանգիստ է ներքուստ։", NativeSceneLanguage.ARMENIAN),
        ambiguous("hy-amb-16", "Կերպարը ուրախ է տեսարանից։", NativeSceneLanguage.ARMENIAN),

        ambiguous("en-amb-1", "The character reflects on childhood.", NativeSceneLanguage.ENGLISH),
        ambiguous("en-amb-2", "The character thinks about the future.", NativeSceneLanguage.ENGLISH),
        ambiguous("en-amb-3", "The character looks at the colors.", NativeSceneLanguage.ENGLISH),
        ambiguous("en-amb-4", "The scene feels calm and quiet.", NativeSceneLanguage.ENGLISH),
        ambiguous("en-amb-5", "The character feels sadness.", NativeSceneLanguage.ENGLISH),
        ambiguous("en-amb-6", "The character smiles for an unclear reason.", NativeSceneLanguage.ENGLISH),
        ambiguous("en-amb-7", "The character remembers home.", NativeSceneLanguage.ENGLISH),
        ambiguous("en-amb-8", "The character dreams about travel.", NativeSceneLanguage.ENGLISH),
        ambiguous("en-amb-9", "The character hears a distant sound.", NativeSceneLanguage.ENGLISH),
        ambiguous("en-amb-10", "The character studies the room.", NativeSceneLanguage.ENGLISH),
        ambiguous("en-amb-11", "The scene suggests nostalgia.", NativeSceneLanguage.ENGLISH),
        ambiguous("en-amb-12", "The character doubts the decision.", NativeSceneLanguage.ENGLISH),
        ambiguous("en-amb-13", "The character appears thoughtful.", NativeSceneLanguage.ENGLISH),
        ambiguous("en-amb-14", "The character admires the light.", NativeSceneLanguage.ENGLISH),
        ambiguous("en-amb-15", "The character feels inward tension.", NativeSceneLanguage.ENGLISH),
        ambiguous("en-amb-16", "The character seems happy.", NativeSceneLanguage.ENGLISH),

        ambiguous("ru-amb-1", "Персонаж вспоминает детство.", NativeSceneLanguage.RUSSIAN),
        ambiguous("ru-amb-2", "Персонаж думает о будущем.", NativeSceneLanguage.RUSSIAN),
        ambiguous("ru-amb-3", "Персонаж смотрит на цвета.", NativeSceneLanguage.RUSSIAN),
        ambiguous("ru-amb-4", "Сцена спокойная и тихая.", NativeSceneLanguage.RUSSIAN),
        ambiguous("ru-amb-5", "Персонаж чувствует грусть.", NativeSceneLanguage.RUSSIAN),
        ambiguous("ru-amb-6", "Персонаж улыбается без ясной причины.", NativeSceneLanguage.RUSSIAN),
        ambiguous("ru-amb-7", "Персонаж вспоминает дом.", NativeSceneLanguage.RUSSIAN),
        ambiguous("ru-amb-8", "Персонаж мечтает о путешествии.", NativeSceneLanguage.RUSSIAN),
        ambiguous("ru-amb-9", "Персонаж слышит далёкий звук.", NativeSceneLanguage.RUSSIAN),
        ambiguous("ru-amb-10", "Персонаж изучает комнату.", NativeSceneLanguage.RUSSIAN),
        ambiguous("ru-amb-11", "Сцена передаёт чувство ностальгии.", NativeSceneLanguage.RUSSIAN),
        ambiguous("ru-amb-12", "Персонаж сомневается в решении.", NativeSceneLanguage.RUSSIAN),
        ambiguous("ru-amb-13", "Персонаж задумчив.", NativeSceneLanguage.RUSSIAN),
        ambiguous("ru-amb-14", "Персонаж любуется светом.", NativeSceneLanguage.RUSSIAN),
        ambiguous("ru-amb-15", "Персонаж испытывает внутреннее напряжение.", NativeSceneLanguage.RUSSIAN),
        ambiguous("ru-amb-16", "Персонаж выглядит счастливым.", NativeSceneLanguage.RUSSIAN),
    )

    private fun supportedDecorations(language: NativeSceneLanguage, base: String): List<String> = when (language) {
        NativeSceneLanguage.ARMENIAN -> listOf(
            base,
            "$base Տևողությունը 20 վայրկյան։",
            "$base Ելքը՝ 320×240, 12 կադր/վրկ։",
            "$base Տևողությունը 24 վայրկյան, ելքը՝ 640×360, 24 կադր/վրկ։",
        )
        NativeSceneLanguage.ENGLISH -> listOf(
            base,
            "$base Duration 20 seconds.",
            "$base Output 320x240 at 12 fps.",
            "$base Duration 24 seconds, output 640x360 at 24 fps.",
        )
        NativeSceneLanguage.RUSSIAN -> listOf(
            base,
            "$base Длительность 20 секунд.",
            "$base Выход 320х240, 12 кадров/с.",
            "$base Длительность 24 секунды, выход 640х360, 24 кадров/с.",
        )
        else -> error("Unsupported benchmark language: $language")
    }

    private fun unsupportedDecorations(language: NativeSceneLanguage, base: String): List<String> = when (language) {
        NativeSceneLanguage.ARMENIAN -> listOf(base, "$base Տևողությունը 20 վայրկյան։")
        NativeSceneLanguage.ENGLISH -> listOf(base, "$base Duration 20 seconds.")
        NativeSceneLanguage.RUSSIAN -> listOf(base, "$base Длительность 20 секунд.")
        else -> error("Unsupported benchmark language: $language")
    }

    private fun executable(id: String, text: String, language: NativeSceneLanguage, concept: NativeSceneConcept) = BenchmarkCase(
        id = id,
        text = text,
        language = language,
        status = NativeSceneSemanticStatus.VALID_EXECUTABLE,
        concept = concept,
    )

    private fun unsupported(id: String, text: String, language: NativeSceneLanguage, concept: NativeSceneConcept) = BenchmarkCase(
        id = id,
        text = text,
        language = language,
        status = NativeSceneSemanticStatus.VALID_BUT_UNSUPPORTED_CAPABILITY,
        concept = concept,
    )

    private fun ambiguous(id: String, text: String, language: NativeSceneLanguage) = BenchmarkCase(
        id = id,
        text = text,
        language = language,
        status = NativeSceneSemanticStatus.AMBIGUOUS_SEMANTICS,
    )
}