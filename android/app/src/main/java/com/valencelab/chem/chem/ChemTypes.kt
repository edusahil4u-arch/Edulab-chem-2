package com.valencelab.chem.chem

enum class ElementCategory(val label: String) {
    NONMETAL("Nonmetal"),
    HALOGEN("Halogen"),
    NOBLE_GAS("Noble Gas"),
    ALKALI_METAL("Alkali Metal"),
    ALKALINE_EARTH("Alkaline Earth"),
    METALLOID("Metalloid"),
    POST_TRANSITION("Post-Transition"),
    TRANSITION_METAL("Transition Metal"),
    LANTHANIDE("Lanthanide"),
    ACTINIDE("Actinide")
}

enum class ElementSymbol(val symbol: String) {
    H("H"), He("He"),
    Li("Li"), Be("Be"), B("B"), C("C"), N("N"), O("O"), F("F"), Ne("Ne"),
    Na("Na"), Mg("Mg"), Al("Al"), Si("Si"), P("P"), S("S"), Cl("Cl"), Ar("Ar"),
    K("K"), Ca("Ca"), Sc("Sc"), Ti("Ti"), V("V"), Cr("Cr"), Mn("Mn"), Fe("Fe"), Co("Co"), Ni("Ni"), Cu("Cu"), Zn("Zn"), Ga("Ga"), Ge("Ge"), As("As"), Se("Se"), Br("Br"), Kr("Kr"),
    Rb("Rb"), Sr("Sr"), Y("Y"), Zr("Zr"), Nb("Nb"), Mo("Mo"), Tc("Tc"), Ru("Ru"), Rh("Rh"), Pd("Pd"), Ag("Ag"), Cd("Cd"), In("In"), Sn("Sn"), Sb("Sb"), Te("Te"), I("I"), Xe("Xe"),
    Cs("Cs"), Ba("Ba"),
    La("La"), Ce("Ce"), Pr("Pr"), Nd("Nd"), Pm("Pm"), Sm("Sm"), Eu("Eu"), Gd("Gd"), Tb("Tb"), Dy("Dy"), Ho("Ho"), Er("Er"), Tm("Tm"), Yb("Yb"), Lu("Lu"),
    Hf("Hf"), Ta("Ta"), W("W"), Re("Re"), Os("Os"), Ir("Ir"), Pt("Pt"), Au("Au"), Hg("Hg"), Tl("Tl"), Pb("Pb"), Bi("Bi"), Po("Po"), At("At"), Rn("Rn"),
    Fr("Fr"), Ra("Ra"),
    Ac("Ac"), Th("Th"), Pa("Pa"), U("U"), Np("Np"), Pu("Pu"), Am("Am"), Cm("Cm"), Bk("Bk"), Cf("Cf"), Es("Es"), Fm("Fm"), Md("Md"), No("No"), Lr("Lr"),
    Rf("Rf"), Db("Db"), Sg("Sg"), Bh("Bh"), Hs("Hs"), Mt("Mt"), Ds("Ds"), Rg("Rg"), Cn("Cn"), Nh("Nh"), Fl("Fl"), Mc("Mc"), Lv("Lv"), Ts("Ts"), Og("Og");

    companion object {
        fun fromString(raw: String): ElementSymbol? =
            entries.firstOrNull { it.symbol == raw }
    }
}

enum class StereoType {
    NONE,
    WEDGE,
    DASH
}

enum class HybridizationType(val label: String) {
    SP3("sp3"),
    SP2("sp2"),
    SP("sp"),
    S("s"),
    UNHYBRIDIZED("unhybridized")
}

enum class VseprGeometry(val label: String) {
    TETRAHEDRAL("Tetrahedral (109.5°)"),
    TRIGONAL_PLANAR("Trigonal Planar (120°)"),
    TRIGONAL_PYRAMIDAL("Trigonal Pyramidal (107°)"),
    BENT("Bent (104.5°)"),
    LINEAR("Linear (180°)"),
    TERMINAL("Terminal (1s)"),
    HYPERVALENT("Hypervalent / Expanded")
}

data class ElementSpec(
    val symbol: ElementSymbol,
    val name: String,
    val atomicNumber: Int,
    val atomicMass: Double,
    val period: Int,
    val group: Int,
    val category: ElementCategory,
    val cpkColorHex: Long,
    val cpkTextColorHex: Long,
    val covalentRadius: Double,
    val vdwRadius: Double,
    val standardValences: List<Int>,
    val defaultValence: Int,
    val electronegativity: Double,
    val lonePairs: Int
)

data class AtomNode(
    val id: String,
    val element: ElementSymbol,
    val x2d: Float,
    val y2d: Float,
    val x3d: Float = 0f,
    val y3d: Float = 0f,
    val z3d: Float = 0f,
    val formalCharge: Int = 0,
    val isAromatic: Boolean = false,
    val explicitH: Int? = null
)

data class BondEdge(
    val id: String,
    val from: String,
    val to: String,
    val order: Int = 1,
    val stereo: StereoType = StereoType.NONE,
    val isAromatic: Boolean = false
)

data class MoleculeGraph(
    val id: String,
    val name: String,
    val iupacName: String? = null,
    val smiles: String? = null,
    val atoms: List<AtomNode>,
    val bonds: List<BondEdge>
)

data class AtomAnalysis(
    val atomId: String,
    val element: ElementSymbol,
    val explicitBondOrderSum: Int,
    val implicitHydrogens: Int,
    val totalCoordination: Int,
    val lonePairs: Int,
    val stericNumber: Int,
    val hybridization: HybridizationType,
    val vseprGeometry: VseprGeometry,
    val valenceValid: Boolean,
    val valenceMessage: String? = null,
    val inRing: Boolean,
    val ringSizes: List<Int>,
    val isAromatic: Boolean
)

data class HybridizationCounts(
    val sp3: Int,
    val sp2: Int,
    val sp: Int
)

data class MoleculeMetrics(
    val formula: String,
    val molecularWeight: Double,
    val heavyAtomCount: Int,
    val explicitAtomCount: Int,
    val totalAtomCountWithH: Int,
    val bondCount: Int,
    val formalCharge: Int,
    val estimatedLogP: Double,
    val tpsa: Double,
    val hbdCount: Int,
    val hbaCount: Int,
    val rotatableBonds: Int,
    val ringCount: Int,
    val lipinskiViolations: Int,
    val lipinskiPass: Boolean,
    val valenceValid: Boolean,
    val valenceWarnings: List<String>,
    val hybridizationCounts: HybridizationCounts,
    val canonicalSmiles: String,
    val atomAnalyses: Map<String, AtomAnalysis>
)

data class PresetMolecule(
    val id: String,
    val name: String,
    val category: String,
    val smiles: String,
    val formula: String,
    val description: String
)

data class FragmentTemplate(
    val id: String,
    val label: String,
    val shortLabel: String,
    val smiles: String
)

data class DeepStructureAnalysis(
    val iupacName: String,
    val commonName: String,
    val stabilityVerdict: String,
    val vseprAndConformation: String,
    val electronicAndResonance: String,
    val functionalGroups: List<String>,
    val predictedSpectroscopy: List<String>,
    val optimizationSuggestions: List<String>
)

data class VisionAnalysisResult(
    val identifiedCompound: String,
    val formula: String,
    val extractedSmiles: String,
    val structuralAnalysis: String,
    val functionalGroups: List<String>,
    val correctionsOrNotes: List<String>
)

data class PubChemCompound(
    val cid: Long,
    val iupacName: String?,
    val molecularFormula: String?,
    val molecularWeight: String?,
    val smiles: String?
)

data class TutorMessage(
    val id: String,
    val isUser: Boolean,
    val content: String,
    val modelUsed: String? = null,
    val suggestedSmiles: String? = null
)
