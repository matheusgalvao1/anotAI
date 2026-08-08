import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../../ai/controllers/settings_controller.dart';
import '../../ai/models/ai_allow_list.dart';
import '../../ai/models/provider_id.dart';
import '../../ai/models/selection.dart';
import '../../notes/data/note_transfer.dart';
import '../controllers/appearance_controller.dart';

class SettingsPage extends StatefulWidget {
  const SettingsPage({
    required this.controller,
    required this.settingsController,
    this.noteTransfer,
    this.onNotesImported,
    super.key,
  });

  final AppearanceController controller;
  final SettingsController settingsController;

  /// When present, renders the Storage section (import/export) backed by the
  /// platform file picker and share sheet.
  final NoteTransfer? noteTransfer;

  /// Invoked after an import so the notes list refreshes.
  final VoidCallback? onNotesImported;

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leadingWidth: 104,
        leading: TextButton.icon(
          onPressed: () => Navigator.of(context).pop(),
          icon: const Icon(CupertinoIcons.chevron_back, size: 20),
          label: const Text('Notes'),
        ),
        title: const Text('Settings'),
      ),
      body: AnimatedBuilder(
        animation: widget.settingsController,
        builder: (context, _) => ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
          children: [
            _Section(
              title: 'Appearance',
              child: SegmentedButton<ThemeMode>(
                segments: const [
                  ButtonSegment(
                    value: ThemeMode.light,
                    icon: Icon(CupertinoIcons.sun_max),
                    label: Text('Light'),
                  ),
                  ButtonSegment(
                    value: ThemeMode.dark,
                    icon: Icon(CupertinoIcons.moon),
                    label: Text('Dark'),
                  ),
                  ButtonSegment(
                    value: ThemeMode.system,
                    icon: Icon(CupertinoIcons.device_phone_portrait),
                    label: Text('System'),
                  ),
                ],
                selected: {widget.controller.themeMode},
                onSelectionChanged: (selection) =>
                    widget.controller.setThemeMode(selection.first),
                showSelectedIcon: false,
              ),
            ),
            const SizedBox(height: 20),
            if (widget.settingsController.allowList != null)
              _AiSections(settingsController: widget.settingsController),
            if (widget.noteTransfer case final transfer?) ...[
              const SizedBox(height: 20),
              _Section(
                title: 'Storage',
                child: _StorageSection(
                  transfer: transfer,
                  onImported: () {
                    widget.onNotesImported?.call();
                    final messenger = ScaffoldMessenger.of(context);
                    messenger
                      ..hideCurrentSnackBar()
                      ..showSnackBar(
                        const SnackBar(content: Text('Notes imported.')),
                      );
                  },
                ),
              ),
            ],
            const SizedBox(height: 20),
            const _Section(
              title: 'About',
              child: ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text('anotAI'),
                subtitle: Text('Flutter UI prototype · local-first notes'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AiSections extends StatelessWidget {
  const _AiSections({required this.settingsController});

  final SettingsController settingsController;

  @override
  Widget build(BuildContext context) {
    final allowList = settingsController.allowList!;
    final selection = settingsController.selection;
    // A selection that no longer resolves against the allow list shows the
    // chooser rather than an empty card.
    final resolvedModel =
        selection != null ? allowList.modelById(selection.modelId) : null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Section(
          title: 'AI providers',
          child: Column(
            children: [
              for (final provider in allowList.providers)
                _ProviderKeyTile(
                  provider: provider,
                  configured: settingsController.hasKey(provider.id),
                  onSave: (key) {
                    if (key.trim().isNotEmpty) {
                      settingsController.setApiKey(provider.id, key);
                    }
                  },
                  onRemove: settingsController.hasKey(provider.id)
                      ? () => settingsController.removeApiKey(provider.id)
                      : null,
                ),
            ],
          ),
        ),
        const SizedBox(height: 20),
        _Section(
          title: 'AI model',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (resolvedModel != null)
                _ModelConfig(
                  key: ValueKey(selection!.modelId),
                  settingsController: settingsController,
                )
              else
                Align(
                  alignment: Alignment.center,
                  child: FilledButton.icon(
                    onPressed: () => _pickModel(context),
                    icon: const Icon(Icons.auto_awesome_rounded, size: 18),
                    label: const Text('Choose a model'),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _pickModel(BuildContext context) async {
    final selected = await showModelPickerSheet(
      context,
      allowList: settingsController.allowList!,
      currentModelId: settingsController.selection?.modelId,
      keys: settingsController.keys,
    );
    if (selected == null || !context.mounted) return;
    final model = settingsController.allowList!.modelById(selected)!;
    await settingsController.setSelection(ModelSelection(
      modelId: model.id,
      reasoning: model.defaultReasoning,
    ));
  }
}

/// The selected (model, provider) entry and its reasoning modes.
class _ModelConfig extends StatelessWidget {
  const _ModelConfig({required this.settingsController, super.key});

  final SettingsController settingsController;

  @override
  Widget build(BuildContext context) {
    final allowList = settingsController.allowList!;
    final selection = settingsController.selection!;
    final model = allowList.modelById(selection.modelId);
    if (model == null) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: const Icon(Icons.smart_toy_outlined),
          title:
              Text(model.label, style: Theme.of(context).textTheme.titleSmall),
          subtitle: Text(allowList.providerById(model.provider)!.label),
          trailing: const Icon(CupertinoIcons.chevron_down, size: 18),
          onTap: () async {
            final picked = await showModelPickerSheet(
              context,
              allowList: allowList,
              currentModelId: model.id,
              keys: settingsController.keys,
            );
            if (picked == null || !context.mounted) return;
            final pickedModel = allowList.modelById(picked)!;
            await settingsController.setSelection(ModelSelection(
              modelId: pickedModel.id,
              reasoning: _keepReasoning(pickedModel, selection.reasoning),
            ));
          },
        ),
        const SizedBox(height: 8),
        Text('REASONING', style: _labelStyle(context)),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 6,
          children: [
            for (final mode in model.reasoningModes)
              ChoiceChip(
                label: Text(mode.label),
                selected: selection.reasoning == mode,
                onSelected: (_) async {
                  await settingsController.setSelection(ModelSelection(
                    modelId: model.id,
                    reasoning: mode,
                  ));
                },
              ),
          ],
        ),
      ],
    );
  }

  static TextStyle _labelStyle(BuildContext context) =>
      Theme.of(context).textTheme.labelSmall?.copyWith(
            color: Theme.of(context).colorScheme.primary,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.8,
          ) ??
      const TextStyle();
}

ReasoningMode _keepReasoning(AiModel picked, ReasoningMode current) =>
    picked.reasoningModes.contains(current) ? current : picked.defaultReasoning;

class _StorageSection extends StatelessWidget {
  const _StorageSection({required this.transfer, required this.onImported});

  final NoteTransfer transfer;
  final VoidCallback onImported;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(Icons.folder_outlined, color: colors.primary),
          title: const Text('Notes folder'),
          subtitle: Text(
            transfer.storagePath,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            OutlinedButton.icon(
              onPressed: () => _import(context),
              icon: const Icon(Icons.file_download_outlined, size: 18),
              label: const Text('Import'),
            ),
            const SizedBox(width: 12),
            OutlinedButton.icon(
              onPressed: () => _export(context),
              icon: const Icon(Icons.ios_share, size: 18),
              label: const Text('Export all'),
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _import(BuildContext context) async {
    await transfer.importNotes();
    if (context.mounted) onImported();
  }

  Future<void> _export(BuildContext context) async {
    final box = context.findRenderObject() as RenderBox?;
    final origin =
        box == null ? null : box.localToGlobal(Offset.zero) & box.size;
    await transfer.exportAll(sharePositionOrigin: origin);
  }
}

class _ProviderKeyTile extends StatelessWidget {
  const _ProviderKeyTile({
    required this.provider,
    required this.configured,
    required this.onSave,
    required this.onRemove,
  });

  final AiProvider provider;
  final bool configured;
  final ValueChanged<String> onSave;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(
        configured ? Icons.shield_outlined : Icons.add_circle_outline,
        color: configured
            ? Theme.of(context).colorScheme.primary
            : Theme.of(context).colorScheme.outline,
      ),
      title: Text(provider.label),
      subtitle: Text(
        configured ? '••••••••••••' : 'No key set',
        style: Theme.of(context).textTheme.bodySmall,
      ),
      trailing: configured
          ? Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  tooltip: 'Edit key',
                  icon: const Icon(Icons.edit_outlined, size: 20),
                  onPressed: () => _editKey(context, ''),
                ),
                IconButton(
                  tooltip: 'Remove key',
                  icon: const Icon(Icons.delete_outline, size: 20),
                  onPressed: () {
                    final result = onRemove;
                    if (result != null) result();
                  },
                ),
              ],
            )
          : TextButton(
              onPressed: () => _editKey(context, ''), child: const Text('Add')),
    );
  }

  Future<void> _editKey(BuildContext context, String currentKey) async {
    final result = await showApiKeySheet(
      context,
      provider: provider,
      currentKey: currentKey,
      onSave: onSave,
    );
    if (result == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${provider.label} key saved.')),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

/// Bottom sheet: one provider + one API key field.
Future<bool?> showApiKeySheet(
  BuildContext context, {
  required AiProvider provider,
  String? currentKey,
  required ValueChanged<String> onSave,
}) {
  String key = currentKey ?? '';

  void finish(BuildContext sheetContext) {
    onSave(key);
    Navigator.of(sheetContext).pop(true);
  }

  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (sheetContext) {
      return SafeArea(
        child: Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 16,
            bottom: MediaQuery.viewInsetsOf(sheetContext).bottom + 16,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(provider.label,
                  style: Theme.of(sheetContext).textTheme.titleMedium),
              const SizedBox(height: 12),
              TextField(
                autofocus: true,
                obscureText: true,
                autocorrect: false,
                enableSuggestions: false,
                decoration: InputDecoration(
                  hintText: provider.keyPlaceholder,
                  border: const OutlineInputBorder(),
                ),
                onChanged: (value) => key = value,
                onSubmitted: (_) => finish(sheetContext),
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => finish(sheetContext),
                  child: const Text('Save'),
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}

/// Bottom sheet: choose a (model, provider) entry, grouped by provider.
/// Entries whose provider has no configured key are shown disabled with a hint.
Future<String?> showModelPickerSheet(
  BuildContext context, {
  required AiAllowList allowList,
  required String? currentModelId,
  required Map<ProviderId, String> keys,
}) {
  final groups = allowList.providers
      .map((provider) => (provider, allowList.modelsFor(provider.id)))
      .where((group) => group.$2.isNotEmpty)
      .toList(growable: false);

  return showModalBottomSheet<String>(
    context: context,
    showDragHandle: true,
    builder: (sheetContext) => SafeArea(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxHeight: 520),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
          children: [
            Text('Choose a model',
                style: Theme.of(sheetContext).textTheme.titleMedium),
            const SizedBox(height: 4),
            for (final (provider, models) in groups) ...[
              Padding(
                padding: const EdgeInsets.only(top: 16, bottom: 4),
                child: Row(
                  children: [
                    Text(
                      provider.label.toUpperCase(),
                      style: Theme.of(sheetContext)
                          .textTheme
                          .labelSmall
                          ?.copyWith(
                            color: Theme.of(sheetContext).colorScheme.primary,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.8,
                          ),
                    ),
                    if (!keys.containsKey(provider.id)) ...[
                      const SizedBox(width: 8),
                      Text(
                        '· add a key to enable',
                        style: Theme.of(sheetContext)
                            .textTheme
                            .bodySmall
                            ?.copyWith(
                              color: Theme.of(sheetContext).colorScheme.outline,
                            ),
                      ),
                    ],
                  ],
                ),
              ),
              for (final model in models)
                ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  enabled: keys.containsKey(provider.id),
                  leading: Icon(
                    model.id == currentModelId
                        ? Icons.radio_button_checked
                        : Icons.radio_button_off,
                    size: 20,
                  ),
                  title: Text(model.label),
                  subtitle: keys.containsKey(provider.id)
                      ? null
                      : Text('Add a ${provider.label} key to use this'),
                  onTap: keys.containsKey(provider.id)
                      ? () => Navigator.of(sheetContext).pop(model.id)
                      : null,
                ),
            ],
          ],
        ),
      ),
    ),
  );
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 8),
          child: Text(
            title.toUpperCase(),
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: colors.primary,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.8,
                ),
          ),
        ),
        Material(
          color: colors.surface,
          borderRadius: BorderRadius.circular(16),
          clipBehavior: Clip.antiAlias,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: SizedBox(width: double.infinity, child: child),
          ),
        ),
      ],
    );
  }
}
