import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

class AiPromptComposer extends StatefulWidget {
  const AiPromptComposer({
    required this.open,
    required this.focusNode,
    required this.status,
    required this.onOpen,
    required this.onClose,
    required this.onSubmit,
    super.key,
  });

  final bool open;
  final FocusNode focusNode;
  final String? status;
  final VoidCallback onOpen;
  final VoidCallback onClose;
  final ValueChanged<String> onSubmit;

  @override
  State<AiPromptComposer> createState() => _AiPromptComposerState();
}

class _AiPromptComposerState extends State<AiPromptComposer> {
  final _promptController = TextEditingController();

  bool get _canSend => _promptController.text.trim().isNotEmpty;

  @override
  void dispose() {
    _promptController.dispose();
    super.dispose();
  }

  void _submit() {
    final prompt = _promptController.text.trim();
    if (prompt.isEmpty) return;
    widget.onSubmit(prompt);
    _promptController.clear();
    setState(() {});
    widget.focusNode.requestFocus();
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    if (!widget.open) {
      return Align(
        alignment: Alignment.bottomRight,
        child: FloatingActionButton.large(
          key: const Key('ai-open-button'),
          heroTag: 'ai-prompt',
          tooltip: 'Ask AI to edit this note',
          onPressed: widget.onOpen,
          child: const Icon(Icons.auto_awesome_rounded, size: 28),
        ),
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.status case final status?)
          Container(
            margin: const EdgeInsets.only(left: 8, right: 64, bottom: 7),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: colors.surfaceContainerHigh,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text(
              status,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: colors.onSurfaceVariant,
                  ),
            ),
          ),
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: Material(
                elevation: 5,
                shadowColor: Colors.black.withValues(alpha: 0.25),
                color: colors.surface,
                borderRadius: BorderRadius.circular(26),
                clipBehavior: Clip.antiAlias,
                child: TextField(
                  key: const Key('ai-prompt-input'),
                  controller: _promptController,
                  focusNode: widget.focusNode,
                  onChanged: (_) => setState(() {}),
                  onSubmitted: (_) => _submit(),
                  minLines: 1,
                  maxLines: 4,
                  textInputAction: TextInputAction.send,
                  decoration: InputDecoration(
                    hintText: 'Ask AI to edit this note…',
                    filled: false,
                    border: InputBorder.none,
                    enabledBorder: InputBorder.none,
                    focusedBorder: InputBorder.none,
                    prefixIcon: IconButton(
                      tooltip: 'Close prompt',
                      onPressed: widget.onClose,
                      icon: const Icon(CupertinoIcons.xmark, size: 18),
                    ),
                    contentPadding: const EdgeInsets.symmetric(vertical: 15),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            FloatingActionButton(
              heroTag: 'send-prompt',
              tooltip: 'Send instruction',
              onPressed: _canSend ? _submit : null,
              backgroundColor:
                  _canSend ? colors.primary : colors.surfaceContainerHighest,
              foregroundColor: _canSend ? colors.onPrimary : colors.outline,
              child: const Icon(CupertinoIcons.arrow_up, size: 23),
            ),
          ],
        ),
      ],
    );
  }
}
