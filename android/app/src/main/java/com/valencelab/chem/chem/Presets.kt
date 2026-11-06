package com.valencelab.chem.chem

object Presets {
    val molecules: List<PresetMolecule> = listOf(
        PresetMolecule(
            id = "aspirin",
            name = "Aspirin",
            category = "Analgesic Ester",
            smiles = "CC(=O)OC1=CC=CC=C1C(=O)O",
            formula = "C9H8O4",
            description = "Acetylsalicylic acid featuring an aromatic benzene core, ester linkage, and carboxylic acid."
        ),
        PresetMolecule(
            id = "caffeine",
            name = "Caffeine",
            category = "Purine Alkaloid",
            smiles = "CN1C=NC2=C1C(=O)N(C(=O)N2C)C",
            formula = "C8H10N4O2",
            description = "Fused pyrimidinedione-imidazole ring system with three N-methyl substituents."
        ),
        PresetMolecule(
            id = "ibuprofen",
            name = "Ibuprofen",
            category = "NSAID Profen",
            smiles = "CC(C)CC1=CC=C(C=C1)C(C)C(=O)O",
            formula = "C13H18O2",
            description = "Isobutylphenyl propionic acid combining lipophilic ring and polar carboxyl head."
        ),
        PresetMolecule(
            id = "serotonin",
            name = "Serotonin",
            category = "Neurotransmitter",
            smiles = "NCCc1c[nH]c2ccc(O)cc12",
            formula = "C10H12N2O",
            description = "5-Hydroxytryptamine indoleamine neurotransmitter with planar bicyclic indole core."
        ),
        PresetMolecule(
            id = "acetaminophen",
            name = "Acetaminophen",
            category = "Amide Analgesic",
            smiles = "CC(=O)NC1=CC=C(C=C1)O",
            formula = "C8H9NO2",
            description = "Paracetamol featuring a para-substituted phenol ring and planar resonance-stabilized amide."
        ),
        PresetMolecule(
            id = "benzene",
            name = "Benzene",
            category = "Aromatic Ring",
            smiles = "c1ccccc1",
            formula = "C6H6",
            description = "Planar hexagonal D6h conjugated pi-system with sp2 hybridized carbons."
        ),
        PresetMolecule(
            id = "ethanol",
            name = "Ethanol",
            category = "Primary Alcohol",
            smiles = "CCO",
            formula = "C2H6O",
            description = "Classic tetrahedral sp3 carbon backbone bonded to a bent polar hydroxyl group."
        ),
        PresetMolecule(
            id = "cyclohexane",
            name = "Cyclohexane",
            category = "Alicyclic Chair",
            smiles = "C1CCCCC1",
            formula = "C6H12",
            description = "Non-planar puckered saturated six-membered ring minimizing torsional and angle strain."
        ),
        PresetMolecule(
            id = "acetic_acid",
            name = "Acetic Acid",
            category = "Carboxylic Acid",
            smiles = "CC(=O)O",
            formula = "C2H4O2",
            description = "Simple carboxylic acid contrasting tetrahedral methyl carbon with trigonal planar carbonyl."
        ),
        PresetMolecule(
            id = "acrylonitrile",
            name = "Acrylonitrile",
            category = "Conjugated Nitrile",
            smiles = "C=CC#N",
            formula = "C3H3N",
            description = "Linear sp nitrile triple bond conjugated with an sp2 vinyl double bond."
        )
    )

    val fragments: List<FragmentTemplate> = listOf(
        FragmentTemplate("oh_group", "Hydroxyl (-OH)", "-OH", "O"),
        FragmentTemplate("nh2_group", "Amino (-NH2)", "-NH₂", "N"),
        FragmentTemplate("carboxyl_group", "Carboxyl (-COOH)", "-COOH", "C(=O)O"),
        FragmentTemplate("aldehyde_group", "Aldehyde (-CHO)", "-CHO", "C=O"),
        FragmentTemplate("nitrile_group", "Nitrile (-CN)", "-CN", "C#N"),
        FragmentTemplate("nitro_group", "Nitro (-NO2)", "-NO₂", "[N+](=O)[O-]"),
        FragmentTemplate("naphthalene_ring", "Naphthalene", "Naphth", "c1ccc2ccccc2c1"),
        FragmentTemplate("indole_ring", "Indole Ring", "Indole", "c1ccc2[nH]ccc2c1")
    )

    fun buildPreset(presetId: String, withExplicitHydrogens: Boolean = false): MoleculeGraph {
        val preset = molecules.firstOrNull { it.id == presetId } ?: molecules.first()
        val parsed = ChemistryEngine.parseSmilesToMolecule(preset.smiles, preset.name)
            .copy(id = preset.id, iupacName = preset.category)
        return if (withExplicitHydrogens) ChemistryEngine.expandHydrogens(parsed) else parsed
    }
}
